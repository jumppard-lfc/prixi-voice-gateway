export type NimalaRequestType = 'appointment' | 'prescription' | 'results' | 'human';

export type NimalaAppointmentType =
  | 'vip_urology'
  | 'preventive_exam'
  | 'consultation'
  | 'postoperative_control'
  | 'steam_prostate_consultation'
  | 'ufm';

export const nimalaBotConfig = {
  id: 'nimala-urologia-david-anovcin',
  clinic: {
    clinicId: '168',
    displayName: 'klinika Nimala',
    specialty: 'urológia MUDr. Dávida Anovčina',
    inboundTwilioNumber: '+420910921238',
    routingPhoneNumber: '+421940621456',
    timezone: 'Europe/Bratislava',
  },
  booking: {
    services: {
      vip_urology: { label: 'VIP termín urológia', durationMinutes: 30, aliases: ['vip termin urologia', 'vip urologia'] },
      preventive_exam: { label: 'Preventívna prehliadka', durationMinutes: 30, aliases: ['preventivna prehliadka', 'preventivne vysetrenie'] },
      consultation: { label: 'Konzultácia', durationMinutes: 30, aliases: ['konzultacia'] },
      postoperative_control: { label: 'Kontrola po operácii', durationMinutes: 15, aliases: ['kontrola po operacii', 'pooperacna kontrola'] },
      steam_prostate_consultation: {
        label: 'Konzultácia k operácii prostaty vodnou parou',
        durationMinutes: 15,
        aliases: ['konzultacia k operacii prostaty vodnou parou', 'operacia prostaty vodnou parou', 'vodna para'],
      },
      ufm: { label: 'UFM', durationMinutes: 10, aliases: ['ufm', 'uroflowmetria', 'uroflow'] },
    },
    availabilityDays: 30,
    offeredSlotCount: 3,
  },
  tts: {
    voiceId: 'zGjIP4SZlMnY9m93k97r',
    modelId: 'eleven_flash_v2_5',
    outputFormat: 'ulaw_8000',
    voiceSettings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: true,
      speed: 1,
    },
  },
  handoff: {
    destinationEnv: 'NIMALA_HUMAN_TRANSFER_NUMBER',
  },
} as const;

