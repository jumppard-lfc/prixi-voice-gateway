const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  buildDentbodyAnswer,
  dentbodyOfficeHoursAnswer,
  isDentbodyFinish,
  parseDentbodyIntents,
} = require('../../src/services/dentbody-nlu.service');

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

test('žiadosť o medicínske odporúčanie nevyberá typ snímky', () => {
  const intents = parseDentbodyIntents('Aký röntgen potrebujem na tento problém?');
  assert.ok(intents.includes('medical_advice'));
  assert.match(buildDentbodyAnswer(intents, 'Aký röntgen potrebujem?'), /ošetrujúceho lekára/);
  assert.deepEqual(parseDentbodyIntents('Aký zubný röntgen potrebujem?'), ['medical_advice']);
});
