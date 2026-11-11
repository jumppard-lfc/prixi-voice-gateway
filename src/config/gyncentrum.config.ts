/**
 * Gyncentrum Dolný Kubín uses the same three-step voicemail intake as the
 * production MUDr. Pekarčík flow: problem, patient name and birth year.
 */
export const gyncentrumBotConfig = {
  id: 'gyncentrum-dolny-kubin',
  clinic: {
    clinicId: '165',
    displayName: 'Gyncentrum Dolný Kubín',
    specialty: 'gynekologická ambulancia',
    inboundTwilioNumber: '+420910927874',
    routingPhoneNumber: '+421948050099',
    timezone: 'Europe/Bratislava',
  },
  copy: {
    greeting: 'Dobrý deň, dovolali ste sa do ambulancie Gyncentrum Dolný Kubín. Som Prixi, vaša virtuálna sestra. Ak máte akútny zdravotný problém, príďte na vyšetrenie bez objednania počas ordinačných hodín. Nájdete ich na stránke www.gyncentrumdéká.sk. Prostredníctvom tejto stránky sa môžete objednať na preventívnu prehliadku, požiadať o predpis receptu alebo vybaviť ďalšie požiadavky. Prosíme, uprednostnite komunikáciu cez www.gyncentrumdéká.sk. Ak nám chcete zanechať telefonický odkaz, po zaznení tónu najskôr stručne opíšte svoj problém. Potom stlačte ľubovoľné tlačidlo a pokračujte podľa pokynov. Ďakujeme.',
    greetingSegments: [
      'Dobrý deň, dovolali ste sa do ambulancie Gyncentrum Dolný Kubín. Som Prixi, vaša virtuálna sestra.',
      'Ak máte akútny zdravotný problém, príďte na vyšetrenie bez objednania počas ordinačných hodín. Nájdete ich na stránke www.gyncentrumdéká.sk.',
      'Prostredníctvom tejto stránky sa môžete objednať na preventívnu prehliadku, požiadať o predpis receptu alebo vybaviť ďalšie požiadavky. Prosíme, uprednostnite komunikáciu cez www.gyncentrumdéká.sk.',
      'Ak nám chcete zanechať telefonický odkaz, po zaznení tónu najskôr stručne opíšte svoj problém. Potom stlačte ľubovoľné tlačidlo a pokračujte podľa pokynov. Ďakujeme.',
    ],
  },
} as const;
