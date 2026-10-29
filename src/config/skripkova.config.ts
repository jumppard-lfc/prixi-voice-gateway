/**
 * MUDr. Skripkova starts with a deliberately short, single-answer intake.
 * The caller says their name and the reason for calling in one recording;
 * the clinic receives both the audio and its transcript in PriXi.
 */
export const skripkovaBotConfig = {
  id: 'mudr-skripkova-pediatricka-ambulancia',
  clinic: {
    clinicId: '164',
    displayName: 'pediatrická ambulancia MUDr. Škripkovej',
    specialty: 'pediatrická ambulancia',
    inboundTwilioNumber: '+420910929573',
    routingPhoneNumber: '+421455442237',
    timezone: 'Europe/Bratislava',
  },
  copy: {
    greeting: 'Dobrý deň, tu je virtuálna sestra PriXi z pediatrickej ambulancie pani doktorky Škripkovej. Prosím, nezložte. Po zaznení signálu mi povedzte svoje meno a dôvod, pre ktorý voláte.',
    completion: 'Ďakujem. Vašu požiadavku som zaznamenala a odovzdám ju ambulancii pani doktorky Škripkovej. Dovidenia.',
    greetingAudioPath: '/media/skripkova-1-greeting-v1.wav',
    completionAudioPath: '/media/skripkova-2-completion-v1.wav',
  },
} as const;
