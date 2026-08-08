import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { seconds, unwrapOrThrow } from '@fitnessos/kernel'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { AthletePorts, AthleteSnapshot } from '../../application/index'
import { athleteKeys } from '../../application/index'
import { AthletePortsProvider } from '../di'
import { OnboardingForm, type OnboardingLabels } from './OnboardingForm'

const LABELS: OnboardingLabels = {
  experienceLabel: 'How long have you been training?',
  experience: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
  disciplinesLabel: 'What kind of training?',
  disciplines: { strength: 'Strength', running: 'Running' },
  daysLabel: 'How many days per week?',
  ceilingLabel: 'Longest session (minutes)',
  ceilingHint: 'Leave blank if you have no limit.',
  submit: 'Continue',
  errors: {
    'days-out-of-range': 'Days per week must be between 1 and 7.',
    'days-not-whole': 'Days per week must be a whole number.',
    'ceiling-too-short': 'A session needs at least 10 minutes.',
    'ceiling-not-positive': 'A session cannot be zero minutes.',
    'no-disciplines': 'Choose at least one kind of training.',
    generic: 'That did not save.',
  },
}

const RESULT: AthleteSnapshot = {
  id: 'a-1' as AthleteSnapshot['id'],
  personId: 'p-1' as AthleteSnapshot['personId'],
  status: 'active',
  trainingIdentity: { experienceLevel: 'advanced', trainingAgeMonths: null, disciplines: ['strength'] },
  availability: {
    daysPerWeek: 4,
    sessionCeiling: unwrapOrThrow(seconds(3600), () => new Error('fixture')),
    equipmentAccess: [],
  },
}

type CompleteOnboarding = AthletePorts['athlete']['completeOnboarding']
type OnboardingCall = Parameters<CompleteOnboarding>[0]

/**
 * Typed, because a bare `vi.fn(() => …)` infers an EMPTY args tuple from the
 * implementation — so `mock.calls[0][0]` is a type error even though the call happens.
 * The type argument restores the real signature.
 */
const spyPort = (impl: CompleteOnboarding): Mock<CompleteOnboarding> =>
  vi.fn<CompleteOnboarding>(impl)

const renderForm = (
  completeOnboarding: AthletePorts['athlete']['completeOnboarding'],
  onComplete = vi.fn(),
) => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const ports: AthletePorts = {
    athlete: {
      getMine: () => Promise.reject(new Error('OnboardingForm must not read')),
      completeOnboarding,
    },
  }
  render(
    <QueryClientProvider client={queryClient}>
      <AthletePortsProvider value={ports}>
        <OnboardingForm
          labels={LABELS}
          disciplineOptions={['strength', 'running']}
          onComplete={onComplete}
        />
      </AthletePortsProvider>
    </QueryClientProvider>,
  )
  return { queryClient, onComplete }
}

const submit = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('OnboardingForm — happy path', () => {
  it('sends the normalised draft and reports the result', async () => {
    const port = spyPort(() => Promise.resolve(RESULT))
    const { onComplete } = renderForm(port)

    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await userEvent.clear(screen.getByLabelText('How many days per week?'))
    await userEvent.type(screen.getByLabelText('How many days per week?'), '5')
    await userEvent.type(screen.getByLabelText('Longest session (minutes)'), '60')
    await submit()

    const call: OnboardingCall = port.mock.calls[0]![0]
    expect(call.trainingIdentity.experienceLevel).toBe('advanced')
    expect(call.trainingIdentity.disciplines).toEqual(['strength'])
    expect(call.availability.daysPerWeek).toBe(5)
    // Minutes in the UI, SECONDS on the wire. N11 forbids an ambiguous magnitude, and
    // this is the one conversion point.
    expect(call.availability.sessionCeilingSeconds).toBe(3600)
    expect(onComplete).toHaveBeenCalledWith(RESULT)
  })

  it('accepts Persian digits in both numeric fields', async () => {
    // Every numeric field in this product needs normalisation, and these two are typed
    // rather than picked — so they are exactly where a Persian keyboard breaks things.
    const port = spyPort(() => Promise.resolve(RESULT))
    renderForm(port)

    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await userEvent.clear(screen.getByLabelText('How many days per week?'))
    await userEvent.type(screen.getByLabelText('How many days per week?'), '۴')
    await userEvent.type(screen.getByLabelText('Longest session (minutes)'), '۴۵')
    await submit()

    const call: OnboardingCall = port.mock.calls[0]![0]
    expect(call.availability.daysPerWeek).toBe(4)
    expect(call.availability.sessionCeilingSeconds).toBe(2700)
  })

  it('sends a null ceiling when the field is left blank', async () => {
    const port = spyPort(() => Promise.resolve(RESULT))
    renderForm(port)

    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await submit()

    const call: OnboardingCall = port.mock.calls[0]![0]
    expect(call.availability.sessionCeilingSeconds).toBeNull()
  })

  it('writes the returned athlete into the cache instead of invalidating', async () => {
    // The mutation already returns the server's view, so invalidating would discard it
    // and refetch what we hold — an extra round trip at the end of a form.
    const { queryClient } = renderForm(() => Promise.resolve(RESULT))

    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await submit()

    await vi.waitFor(() => {
      expect(queryClient.getQueryData(athleteKeys.mine())).toEqual(RESULT)
    })
  })
})

describe('OnboardingForm — domain rules surface on the form', () => {
  const neverCalled = spyPort(() => Promise.resolve(RESULT))

  it('refuses to submit with no discipline selected', async () => {
    const port = spyPort(() => Promise.resolve(RESULT))
    renderForm(port)

    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose at least one kind of training.',
    )
    // Not sent. The rule is enforced before the request, so a round trip is not spent
    // discovering something the client already knew.
    expect(port).not.toHaveBeenCalled()
  })

  it('rejects days out of range with the specific message', async () => {
    renderForm(neverCalled)
    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await userEvent.clear(screen.getByLabelText('How many days per week?'))
    await userEvent.type(screen.getByLabelText('How many days per week?'), '9')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('between 1 and 7')
  })

  it('rejects a zero ceiling with a message that points at the blank alternative', async () => {
    // Zero means "cannot train at all", which is a different statement from "no limit".
    // The message has to tell the athlete which one they meant.
    renderForm(neverCalled)
    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await userEvent.type(screen.getByLabelText('Longest session (minutes)'), '0')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be zero')
  })

  it('rejects a ceiling below the ten-minute floor', async () => {
    renderForm(neverCalled)
    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await userEvent.type(screen.getByLabelText('Longest session (minutes)'), '5')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 10 minutes')
  })

  it('shows a generic message when the port itself fails', async () => {
    renderForm(() => Promise.reject(new Error('boom: connection reset by peer')))
    await userEvent.click(screen.getByRole('button', { name: 'Strength' }))
    await submit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That did not save.')
    // Never the underlying message: it is written for an operator, not an athlete.
    expect(alert).not.toHaveTextContent('connection reset')
  })
})

describe('OnboardingForm — accessibility', () => {
  it('reports toggle state, not just a button label', async () => {
    // Without aria-pressed a screen reader announces "button" and never says whether
    // the discipline is selected — leaving the user unable to tell what they chose.
    renderForm(neverCalledPort())
    const strength = screen.getByRole('button', { name: 'Strength' })
    expect(strength).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(strength)
    expect(strength).toHaveAttribute('aria-pressed', 'true')
  })

  it('groups each question under a legend', () => {
    renderForm(neverCalledPort())
    expect(screen.getByText('How long have you been training?').tagName).toBe('LEGEND')
    expect(screen.getByText('What kind of training?').tagName).toBe('LEGEND')
  })

  it('renders numeric inputs LTR inside an RTL page', () => {
    renderForm(neverCalledPort())
    expect(screen.getByLabelText('How many days per week?')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByLabelText('Longest session (minutes)')).toHaveAttribute('dir', 'ltr')
  })
})

function neverCalledPort(): AthletePorts['athlete']['completeOnboarding'] {
  return () => Promise.reject(new Error('should not submit'))
}
