# MUDr. Kutáková — návrh predregistračného voice flowu

Toto je prvá pracovná mustra na pripomienkovanie s pani doktorkou. Voice bot je
navrhnutý pre obdobie pred otvorením ambulancie v decembri. Predregistrácia je
žiadosť o budúci kontakt, nie automatické prijatie pacienta ani termín.

## Navrhovaný rozhovor

1. Bot predstaví pripravovanú ambulanciu a vysvetlí význam predregistrácie.
2. Pacient hlasom alebo klávesou udelí súhlas so zaznamenaním údajov a spätným
   kontaktom. Bez súhlasu sa nič neuloží.
3. Pacient uvedie meno a priezvisko.
4. Pacient uvedie celý dátum narodenia.
5. Pacient vyberie zdravotnú poisťovňu: VšZP, Dôvera, Union alebo inú.
6. Pacient uvedie iba obec alebo mesto bydliska.
7. Bot všetky údaje zhrnie. Až po záverečnom potvrdení odošle požiadavku.
8. Bot jasne oznámi, že registrácia ešte nie je potvrdená a ambulancia pacienta
   kontaktuje na čísle, z ktorého volal.

Voice bot zámerne nepýta rodné číslo, e-mail ani úplnú adresu. Tieto údaje môže
ambulancia bezpečne doplniť po overení pacienta.

## EDS/Curo kontrakt

Gateway používa rovnakú idempotentnú udalosť
`patient_request.created` ako Neurocentrum a posiela ju na existujúce rozhranie
`POST /api/voice/event`. Predregistrácia sa prenesie ako samostatný typ
`pre_registration`, ktorý sa v PriXi zobrazí ako „Predregistrácia pacienta“.
`CallSid` je zároveň `Idempotency-Key`. Úspech pacientovi potvrdí až po tom, čo
EDS potvrdí uloženie.

Príznak `existingPatient: false` vyjadruje, že ide o predregistráciu nového
pacienta. EDS pacienta naďalej priraďuje iba podľa mena a dátumu narodenia v
rámci konkrétnej ambulancie.

```json
{
  "event": "patient_request.created",
  "version": 1,
  "clinicId": "158",
  "callSid": "CA...",
  "occurredAt": "2026-10-20T12:00:00.000Z",
  "call": {
    "phone": "+421...",
    "durationSeconds": 74
  },
  "patient": {
    "existingPatient": false,
    "firstName": "Jana",
    "lastName": "Nováková",
    "birthDate": "1985-04-12"
  },
  "request": {
    "type": "pre_registration",
    "detail": "PREDREGISTRÁCIA NOVÉHO PACIENTA pred otvorením ambulancie.\nNejde o potvrdenú registráciu ani objednanie na vyšetrenie.\nPoisťovňa: Dôvera.\nBydlisko: Bratislava.\nSúhlas so zaznamenaním údajov a spätným kontaktom: áno (2026-10-20T11:59:20.000Z)."
  }
}
```

EDS túto udalosť spracuje existujúcou cestou. Ak má ambulancia zapnutú Curo
integráciu a nastaveného vlastného príjemcu, EDS ju odošle aj do Curo; dovtedy
zostane požiadavka bezpečne uložená pod ambulanciou 158 v EDS. Gateway
nevytvára pacienta v Curo priamo, takže validácia, deduplikácia a audit zostanú
na jednom mieste rovnako ako pri Neurocentre. Po zapnutí Curo sa typ zobrazí ako
„Predregistrácia pacienta“.

## Otázky pre pani doktorku

- Presný názov ambulancie a plánovaný dátum otvorenia.
- Spádová oblasť alebo obce, z ktorých bude prijímať pacientov.
- Či prijíma všetky tri poisťovne a ako rieši samoplatcov.
- Maximálny počet predregistrovaných pacientov a postup po naplnení kapacity.
- Kedy a kto bude pacientom volať späť.
- Aké ďalšie údaje potrebuje pred spätným kontaktom.
- Schválené znenie súhlasu a informačnej povinnosti o ochrane osobných údajov.
- Curo cieľ: typ požiadavky, pracovný zoznam, štítok a zodpovedná osoba.
- Čo má bot povedať pacientom mimo spádovej oblasti alebo po naplnení kapacity.
