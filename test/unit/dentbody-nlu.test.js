const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  buildDentbodyAnswer,
  buildDentbodyResponse,
  dentbodyOfficeHoursAnswer,
  dentbodyOfficeHoursResponse,
  isDentbodyFinish,
  parseDentbodyIntents,
  shouldEndDentbodyConversation,
} = require('../../src/services/dentbody-nlu.service');

test('každý informačný zámer je priradený k správnej ElevenLabs nahrávke', () => {
  const cases = [
    ['appointment', 'appointment'],
    ['referral', 'referral'],
    ['address', 'address'],
    ['floor', 'floor'],
    ['patients', 'patients'],
    ['payment', 'payment'],
    ['dental_images', 'dentalImages'],
    ['general_images', 'generalImages'],
    ['radiology_report', 'radiologyReport'],
    ['certificate', 'certificate'],
    ['retrospective_image', 'retrospectiveImage'],
    ['contact', 'contact'],
    ['pricing', 'pricing'],
    ['medical_advice', 'medicalAdvice'],
  ];

  for (const [intent, expectedAudioKey] of cases) {
    assert.deepEqual(buildDentbodyResponse([intent], 'test').audioKeys, [expectedAudioKey]);
  }

  assert.deepEqual(
    buildDentbodyResponse(['appointment', 'referral'], 'Musím sa objednať a potrebujem žiadanku?').audioKeys,
    ['appointment', 'referral']
  );
});

test('všetky dynamické varianty ordinačných hodín majú vlastnú nahrávku', () => {
  const at = iso => DateTime.fromISO(iso, { zone: 'Europe/Bratislava' });
  const cases = [
    ['Aké máte ordinačné hodiny?', '2026-10-26T10:00:00', 'hoursFullWeek'],
    ['Ako ste otvorení v pondelok?', '2026-10-26T10:00:00', 'hoursMonday'],
    ['Ako ste otvorení v utorok?', '2026-10-26T10:00:00', 'hoursTuesday'],
    ['Ako ste otvorení v stredu?', '2026-10-26T10:00:00', 'hoursWednesday'],
    ['Ako ste otvorení vo štvrtok?', '2026-10-26T10:00:00', 'hoursThursday'],
    ['Ako ste otvorení v piatok?', '2026-10-26T10:00:00', 'hoursFriday'],
    ['Ako ste otvorení v sobotu?', '2026-10-26T10:00:00', 'hoursSaturday'],
    ['Ako ste otvorení v nedeľu?', '2026-10-26T10:00:00', 'hoursSunday'],
    ['Ste otvorení cez víkend?', '2026-10-26T10:00:00', 'hoursWeekend'],
    ['Ste dnes otvorení?', '2026-10-31T10:00:00', 'todaySaturdayClosed'],
    ['Ste dnes otvorení?', '2026-11-01T10:00:00', 'todaySundayClosed'],
    ['Ste teraz otvorení?', '2026-10-26T10:00:00', 'openMondayMorning'],
    ['Ste teraz otvorení?', '2026-10-27T10:00:00', 'openTuesdayThursdayMorning'],
    ['Ste teraz otvorení?', '2026-10-26T14:00:00', 'openMondayAfternoon'],
    ['Ste teraz otvorení?', '2026-10-28T14:00:00', 'openTuesdayThursdayAfternoon'],
    ['Ste teraz otvorení?', '2026-10-30T10:00:00', 'openFriday'],
    ['Ste teraz otvorení?', '2026-10-26T12:45:00', 'lunchMonday'],
    ['Ste teraz otvorení?', '2026-10-27T12:45:00', 'lunchTuesdayThursday'],
    ['Ste teraz otvorení?', '2026-10-26T06:00:00', 'opensToday'],
    ['Ste teraz otvorení?', '2026-10-26T17:00:00', 'closedToday'],
  ];

  for (const [question, iso, expectedAudioKey] of cases) {
    assert.deepEqual(
      dentbodyOfficeHoursResponse(question, at(iso)).audioKeys,
      [expectedAudioKey],
      `${question} at ${iso}`
    );
  }
});

test('rozpozná viac informačných zámerov v jednej prirodzenej otázke', () => {
  assert.deepEqual(
    parseDentbodyIntents('Treba sa objednať a potrebujem výmenný lístok?'),
    ['appointment', 'referral']
  );
  assert.deepEqual(
    parseDentbodyIntents('Kde vás nájdem a môžem platiť kartou?'),
    ['address', 'payment']
  );
});

test('pokrýva všetky schválené Dentbody informačné témy', () => {
  const cases = [
    ['Musím sa objednať na röntgen?', 'appointment'],
    ['Aké máte ordinačné hodiny?', 'office_hours'],
    ['Kde vás nájdem?', 'address'],
    ['Môžem prísť bez žiadanky?', 'referral'],
    ['Robíte vyšetrenia aj deťom a imobilným pacientom?', 'patients'],
    ['Dá sa platiť kartou?', 'payment'],
    ['Ako dostanem zubnú RTG snímku?', 'dental_images'],
    ['Dostanem všeobecnú RTG snímku na CD?', 'general_images'],
    ['Kedy bude hotový popis od rádiológa?', 'radiology_report'],
    ['Vystavíte mi priepustku?', 'certificate'],
    ['Koľko stojí vyšetrenie?', 'pricing'],
    ['Aký je váš web a e-mail?', 'contact'],
  ];

  for (const [question, expectedIntent] of cases) {
    assert.ok(parseDentbodyIntents(question).includes(expectedIntent), `${question} -> ${expectedIntent}`);
  }
});

test('rozpozná prirodzené otázky na polohu pracoviska', () => {
  const addressQuestions = [
    'Kde sa nachádza ambulancia?',
    'Kde sa prosím nachádza ambulancia?',
    'Prosím vás, kde sa vlastne nachádza vaše pracovisko?',
    'Viete mi povedať, kde vás nájdem?',
    'Kde vás nájdem?',
    'Kde nájdem ambulanciu?',
    'Kde ste?',
    'Kam mám ísť?',
    'Ako sa k vám mám dostať?',
    'Ako sa dostanem k vám?',
  ];

  for (const question of addressQuestions) {
    assert.ok(parseDentbodyIntents(question).includes('address'), question);
  }

  assert.deepEqual(parseDentbodyIntents('Kde môžem zaplatiť kartou?'), ['payment']);
  assert.deepEqual(parseDentbodyIntents('Kde vám môžem poslať e-mail?'), ['contact']);

  assert.deepEqual(parseDentbodyIntents('Na ktorom poschodí vás nájdem?'), ['floor']);
  assert.match(
    buildDentbodyAnswer(['floor'], 'Na ktorom poschodí vás nájdem?'),
    /na prvom poschodí.*Fedinovej 9/
  );
  assert.match(
    buildDentbodyAnswer(['address'], 'Kde sa nachádza ambulancia?'),
    /na prvom poschodí.*Fedinovej 9/
  );
});

test('spätné zaslanie snímky má samostatný bezpečný postup', () => {
  const intents = parseDentbodyIntents('Potrebujem spätne poslať staršiu RTG snímku e-mailom');
  assert.deepEqual(intents, ['retrospective_image']);
  const answer = buildDentbodyAnswer(intents, 'Potrebujem spätne poslať snímku');
  assert.match(answer, /meno, priezvisko a rodné číslo/);
  assert.match(answer, /nehovorte telefonicky/);
});

test('otázka na dnešné hodiny zohľadní obednú prestávku', () => {
  const mondayLunch = DateTime.fromISO('2026-10-26T12:45:00', { zone: 'Europe/Bratislava' });
  const answer = dentbodyOfficeHoursAnswer('Ste teraz otvorení?', mondayLunch);
  assert.match(answer, /obedná prestávka/);
  assert.match(answer, /od trinástej do šestnástej tridsať/);
});

test('hodiny pre konkrétny deň vrátia iba požadovaný deň', () => {
  const answer = dentbodyOfficeHoursAnswer('Ako ste otvorení v piatok?');
  assert.match(answer, /V piatok/);
  assert.match(answer, /do trinástej/);
  assert.doesNotMatch(answer, /pondelok/);
});

test('hodiny rozumejú aj zajtrajšku a víkendu', () => {
  const friday = DateTime.fromISO('2026-10-30T10:00:00', { zone: 'Europe/Bratislava' });
  assert.match(dentbodyOfficeHoursAnswer('Ako ste otvorení zajtra?', friday), /sobotu máme zatvorené/);
  assert.match(dentbodyOfficeHoursAnswer('Ste otvorení cez víkend?', friday), /sobotu a v nedeľu máme zatvorené/);
});

test('bot ukončí rozhovor po prirodzenom poďakovaní', () => {
  assert.equal(isDentbodyFinish('Nie, ďakujem, to je všetko.'), true);
  assert.equal(isDentbodyFinish('Nie, to bude všetko, ďakujem.'), true);
  assert.equal(isDentbodyFinish('Už nepotrebujem nič viac.'), true);
  assert.equal(isDentbodyFinish('Nie, už nič ďalšie nepotrebujem, ďakujem.'), true);
  assert.equal(isDentbodyFinish('To bude všetko.'), true);
  assert.equal(isDentbodyFinish('Potrebujem výsledok'), false);
  assert.equal(isDentbodyFinish('Nie, chcem sa opýtať na žiadanku'), false);
  assert.equal(isDentbodyFinish('Nepotrebujem výmenný lístok'), false);
});

test('krátku zápornú odpoveď vyhodnotí podľa kontextu doplňujúcej otázky', () => {
  assert.equal(shouldEndDentbodyConversation('Už nie, ďakujem pekne', true, false), true);
  assert.equal(shouldEndDentbodyConversation('Nie', true, false), true);
  assert.equal(shouldEndDentbodyConversation('Ďakujem pekne', true, false), true);
  assert.equal(shouldEndDentbodyConversation('Už nie, ďakujem pekne', false, false), false);
  assert.equal(shouldEndDentbodyConversation('Nie', false, false), false);
  assert.equal(shouldEndDentbodyConversation('Ďakujem za informáciu', true, false), true);
  assert.equal(shouldEndDentbodyConversation('Nie, ale kedy máte otvorené?', true, true), false);
  assert.equal(shouldEndDentbodyConversation('Nie, mám ešte jednu otázku', true, false), false);
  assert.equal(shouldEndDentbodyConversation('Nepotrebujem výmenný lístok', true, true), false);
});

test('žiadosť o medicínske odporúčanie nevyberá typ snímky', () => {
  const intents = parseDentbodyIntents('Aký röntgen potrebujem na tento problém?');
  assert.ok(intents.includes('medical_advice'));
  assert.match(buildDentbodyAnswer(intents, 'Aký röntgen potrebujem?'), /ošetrujúceho lekára/);
  assert.deepEqual(parseDentbodyIntents('Aký zubný röntgen potrebujem?'), ['medical_advice']);
});
