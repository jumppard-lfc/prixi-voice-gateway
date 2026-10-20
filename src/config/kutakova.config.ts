export type KutakovaHealthInsurer = 'Všeobecná zdravotná poisťovňa' | 'Dôvera' | 'Union' | 'Iná alebo neuvedená';

export interface KutakovaBotConfig {
  id: string;
  clinic: {
    clinicId: string;
    displayName: string;
    doctorName: string;
    inboundTwilioNumber: string;
    timezone: string;
  };
  messages: {
    greeting: string;
    consent: string;
    declined: string;
    completion: string;
    technical: string;
    urgent: string;
  };
}

/**
 * Initial pre-registration template for review with MUDr. Kutáková.
 * Clinic-specific wording is intentionally kept here so it can be adjusted
 * after the doctor supplies opening, catchment and acceptance details.
 */
export const kutakovaBotConfig: KutakovaBotConfig = {
  id: 'mudr-kutakova-preregistration',
  clinic: {
    clinicId: '158',
    displayName: 'Ambulancia všeobecného lekára pre dospelých',
    doctorName: 'MUDr. Kutáková',
    inboundTwilioNumber: '+420910924343',
    timezone: 'Europe/Bratislava',
  },
  messages: {
    greeting: 'Dobrý deň, dovolali ste sa do pripravovanej ambulancie všeobecnej lekárky pani doktorky Kutákovej. Ambulancia sa má otvoriť v decembri. Cez túto linku môžete požiadať o predregistráciu. Predregistrácia ešte nie je potvrdenou registráciou ani objednaním na vyšetrenie.',
    consent: 'Súhlasíte, aby sme na účel predregistrácie zaznamenali údaje, ktoré nám teraz poviete, a aby vás ambulancia kontaktovala na telefónnom čísle, z ktorého voláte? Povedzte áno alebo stlačte jednotku. Ak nesúhlasíte, povedzte nie alebo stlačte dvojku.',
    declined: 'Rozumiem. Bez vášho súhlasu údaje nezaznamenáme. Keď budete chcieť pokračovať, zavolajte, prosím, znova. Dovidenia.',
    completion: 'Ďakujeme. Vašu žiadosť o predregistráciu sme bezpečne zaznamenali. Nejde ešte o potvrdenú registráciu. Ambulancia vás bude kontaktovať na telefónnom čísle, z ktorého voláte, a dohodne s vami ďalší postup. Dovidenia.',
    technical: 'Momentálne sa nám nepodarilo vašu predregistráciu bezpečne uložiť. Skúste, prosím, zavolať neskôr. Dovidenia.',
    urgent: 'Táto linka neslúži na riešenie akútnych zdravotných ťažkostí. Ak ide o náhly život ohrozujúci stav, volajte 155 alebo 112.',
  },
};
