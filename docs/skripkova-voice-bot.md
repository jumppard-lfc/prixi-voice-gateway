# Voice bot pre pediatrickú ambulanciu MUDr. Škripkovej

## Produkčné smerovanie

- Twilio DID: `+420910929573`
- číslo ambulancie / routing number: `+421455442237`
- PriXi clinic ID: `164`
- vstupný webhook: `POST /voice/incoming`
- status callback: `POST /voice/call-status`

Flow používa jednu súvislú nahrávku. Volajúci v jednej odpovedi povie svoje meno aj dôvod volania. PriXi dostane pôvodné audio a celý prepis; bot sa už nepýta na rok narodenia ani na ďalšie údaje.

## Texty

Úvod:

> Dobrý deň, tu je virtuálna sestra PriXi z pediatrickej ambulancie pani doktorky Škripkovej. Prosím, nezložte. Po zaznení signálu mi povedzte svoje meno a dôvod, pre ktorý voláte.

Záver:

> Ďakujem. Vašu požiadavku som zaznamenala a odovzdám ju ambulancii pani doktorky Škripkovej. Dovidenia.

## ElevenLabs nahrávky

Pre prirodzenú slovenskú výslovnosť najprv otestovať hlas **Dianka** s modelom `eleven_multilingual_v2`. Odporúčané východiskové nastavenie: stability `0.65`, similarity `0.80`, style `0.15`, speaker boost zapnutý. Pred nasadením treba vypočuť najmä výslovnosť slov „PriXi“, „pediatrickej“ a „Škripkovej“ cez telefónny reproduktor.

Vygenerovať dva súbory a uložiť ich do `src/assets/audio/`:

- `skripkova-1-greeting-v1.wav`
- `skripkova-2-completion-v1.wav`

Ak ElevenLabs vráti MP3, previesť ho do úsporného mono WAV vhodného pre telefonovanie:

```bash
ffmpeg -i greeting.mp3 -ac 1 -ar 8000 -c:a pcm_mulaw src/assets/audio/skripkova-1-greeting-v1.wav
ffmpeg -i completion.mp3 -ac 1 -ar 8000 -c:a pcm_mulaw src/assets/audio/skripkova-2-completion-v1.wav
```

Gateway automaticky používa tieto statické WAV nahrávky. Ak by niektorá chýbala, bezpečne použije slovenský Google Wavenet TTS hlas.
