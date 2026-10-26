export type DentbodyIntent =
  | 'appointment'
  | 'office_hours'
  | 'address'
  | 'referral'
  | 'patients'
  | 'payment'
  | 'dental_images'
  | 'general_images'
  | 'radiology_report'
  | 'certificate'
  | 'retrospective_image'
  | 'contact'
  | 'pricing'
  | 'medical_advice';

export const dentbodyBotConfig = {
  id: 'dentbody-xray-petrzalka',
  clinic: {
    clinicId: '163',
    displayName: 'Dentbody X-ray',
    specialty: 'zubné a všeobecné RTG',
    inboundTwilioNumber: '+420910923269',
    publicPhoneNumber: '+421904810888',
    timezone: 'Europe/Bratislava',
    address: 'Zdravotné stredisko FEDINOVA, Fedinova 9, Bratislava – Petržalka',
    email: 'ambulancia.rtg@dentbodyxray.sk',
    website: 'www.dentbodyxray.sk',
  },
} as const;
