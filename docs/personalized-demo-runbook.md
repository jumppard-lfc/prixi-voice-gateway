# Reprodukovateľný ICP demo runbook

Tento postup slúži na vytvorenie bezpečného personalizovaného **demo** voice bota a jedného cold e-mailu. Nezapína produkčné rezervácie ani nemení existujúce čísla klientov.

Príklad v tomto dokumente je **Dental Centrum NIVY, Bratislava**. Jeho web uvádza online rezervačný systém pre vybrané služby a telefonickú rezerváciu pre všetky služby. To je konkrétny dôvod, prečo je vhodným ICP pre PriXi demo: pacient si vie zvoliť službu a termín telefonicky, zatiaľ čo ambulancia má jasný existujúci online rezervačný proces.

## Bezpečné hranice

- Nepouži existujúce produkčné Twilio číslo kliniky ani webhook na ňom.
- Neprepisuj existujúci `configs/demo-voice-bots/dental-centrum-nivy-bratislava.json`; ide o starší demo flow s vlastným číslom.
- Pre toto cvičenie vytvor nový bot `dental-centrum-nivy-tree-demo` a nové Twilio číslo s Voice podporou.
- `provider.mode` zostáva `demo_mock`: termíny sú len simulované a nič sa nezapisuje do Bookio, PriXi ani kalendára kliniky.
- E-mail priprav, ale neposielaj ho bez vlastného schválenia obsahu, adresáta a demo čísla.

## Časť A — lead card pred tvorbou dema

Zaznamenaj iba overené fakty, ktoré môžeš použiť v personalizácii:

| Pole | Hodnota |
| --- | --- |
| Klinika | Dental Centrum NIVY |
| Lokalita | Budovateľská 4, Bratislava |
| Vstupný kanál | Online rezervačný systém pre vybrané služby + telefonické objednanie pre všetky služby |
| Verejné telefónne číslo | `+421 948 605 747` |
| Verejný e-mail | `info@dentalcentrumnivy.eu` |
| Relevantné online služby | vstupné vyšetrenie, zubná pohotovosť, dentálna hygiena, bielenie, zubná konzultácia a ďalšie |
| Demo hypotéza | Volajúci pacient dostane rovnaký riadený výber služby a termínu ako online používateľ; recepcia nemusí manuálne zbierať základnú požiadavku. |

Zdroj pred vytvorením dema vždy otvor a skontroluj: [Ako sa objednať](https://dentalcentrumnivy.eu/ako-sa-objednat/) a [web kliniky](https://dentalcentrumnivy.eu/). Neprenášaj do e-mailu neoverené údaje o kapacitách, konkrétnych lekároch ani používanom booking softvéri.

## Časť B — vytvorenie nového demo čísla

1. V Twilio otvor **Phone Numbers → Buy a number**.
2. Kúp nové číslo s podporou **Voice**. Označ si ho napr. `Dental Centrum NIVY — tree demo`.
3. Zapíš číslo do lead card ako `DEMO_TWILIO_NUMBER`.
4. Ešte na ňom nenastavuj webhook. Najprv vytvor a nasaď konfiguráciu bota.

## Časť C — strom v Voice Bot Builderi

1. Otvor Builder s platným tokenom:

   ```text
   https://prixi-voice-gateway.onrender.com/admin/voice-bot-builder?token=<VOICE_BOT_BUILDER_TOKEN>
   ```

2. V časti **Klinika a provider** nastav:

   | Pole | Hodnota |
   | --- | --- |
   | Názov kliniky | `Dental Centrum NIVY` |
   | Odbor | `zubná klinika` |
   | Verejné číslo kliniky | `+421948605747` |
   | Dedikované Twilio číslo bota | nechaj prázdne |
   | Booking provider | `Iný systém / vlastný konektor` |
   | Technické ID bota | `dental-centrum-nivy-tree-demo` |

3. Klikni **Načítať ukážkový strom**.
4. Uprav úvodnú otázku tak, aby transparentne vysvetlila demo:

   ```text
   Dobrý deň, vítam vás v Dental Centrum NIVY. Som virtuálna asistentka PriXi v ukážkovom režime. Pomôžem vám vybrať typ návštevy a vhodný termín. Môžete odpovedať hlasom alebo stlačiť číslo na klávesnici.
   ```

5. V uzle `typ-navstevy` ponechaj pre prvé demo najviac päť odpovedí. Príklad:

   | Odpoveď | Hlasové synonymá | DTMF | Cieľ |
   | --- | --- | --- | --- |
   | Vstupné vyšetrenie | `prvá návšteva,nový pacient,vstupné` | `1` | `kedy-vyhovuje` |
   | Zubná pohotovosť | `bolesť zuba,akútne,pohotovosť` | `2` | `kedy-vyhovuje` |
   | Dentálna hygiena | `hygiena,čistenie zubov` | `3` | `kedy-vyhovuje` |
   | Profesionálne bielenie | `bielenie,bielenie zubov` | `4` | `kedy-vyhovuje` |
   | Zubná konzultácia | `konzultácia,poradenstvo` | `5` | `kedy-vyhovuje` |

6. V uzle `kedy-vyhovuje` ponechaj:

   | Odpoveď | DTMF | Cieľ |
   | --- | --- |
   | Najbližší voľný termín | `1` | `volne-terminy` |
   | Termín dopoludnia | `2` | `volne-terminy` |
   | Termín popoludní | `3` | `volne-terminy` |

   - `Uložiť odpoveď ako`: `cas`
   - potvrdenie: vypnuté, aby sa pacient plynulo dostal k termínom.

7. V uzle **Voľné termíny** nastav presne:

   | Pole | Hodnota |
   | --- | --- |
   | ID uzla | `volne-terminy` |
   | Pokračovať na | `rezervovane` |
   | Premenná služby | `navsteva` |
   | Premenná preferencie | `cas` |
   | Uložiť vybraný termín ako | `termin` |
   | Potvrdiť termín áno / nie | zapnuté |

8. V koncovom uzle `rezervovane` nastav:

   - výsledok: **Demo rezervácia + SMS**,
   - záverečná veta:

     ```text
     Ďakujem. Vaša demo rezervácia na {{navsteva}}, {{termin}}, je potvrdená. Potvrdzujúcu SMS vám posielame hneď po hovore. Ďakujeme a dovidenia.
     ```

   - SMS text:

     ```text
     Dental Centrum NIVY: demo rezervácia na {{navsteva}}, {{termin}}, je potvrdená.
     ```

9. Skontroluj diagram stromu. Každý cieľový uzol musí existovať a vetva `objednanie` musí viesť až po `rezervovane`.
10. Klikni **Overiť konfiguráciu** a až po úspešnej validácii **Stiahnuť JSON pre Git**.

## Časť D — verzovanie a nasadenie

1. Presuň stiahnutý súbor do repozitára:

   ```bash
   mv ~/Downloads/dental-centrum-nivy-tree-demo.json configs/demo-voice-bots/
   ```

2. Over pracovnú vetvu a zmeny:

   ```bash
   git branch --show-current
   git status --short
   ```

3. Skontroluj, že nový súbor obsahuje `conversationTree` a `"mode": "demo_mock"`:

   ```bash
   rg -n 'conversationTree|demo_mock' configs/demo-voice-bots/dental-centrum-nivy-tree-demo.json
   ```

4. Commitni a pushni:

   ```bash
   git add configs/demo-voice-bots/dental-centrum-nivy-tree-demo.json
   git commit -m "feat: add Dental Centrum NIVY tree demo"
   git push origin fine-tuning
   ```

5. Počkaj, kým je príslušný Render deploy označený ako **Live**.

## Časť E — prepojenie Twilio

Na novom Twilio čísle nastav **Voice Configuration → A Call Comes In**:

| Nastavenie | Hodnota |
| --- | --- |
| Typ | `Webhook` |
| Metóda | `POST` |
| URL | `https://prixi-voice-gateway.onrender.com/voice/demo/dental-centrum-nivy-tree-demo/incoming` |

Ulož zmenu. Nezasahuj do žiadneho iného Twilio čísla.

## Časť F — testovací scenár pred e-mailom

Zavolaj na `DEMO_TWILIO_NUMBER` a prejdi tieto testy:

1. Hlasom povedz „chcem dentálnu hygienu“.
2. Pri časovej preferencii povedz „dopoludnia“.
3. Vyber termín jeho číslom, napr. `1`, a potvrď „áno“.
4. V druhom hovore zvoľ službu klávesnicou.
5. V treťom hovore povedz pri potvrdení „nie“ a vyber iný termín; bot má prepnúť na klávesnicu.
6. Ak má demo posielať SMS, potvrď, že Render má BulkGate údaje aj `DEMO_BOOKING_SMS_ENABLED=true`, a over doručenie na vlastnom testovacom telefóne.

Úspešné demo nikdy nevytvorí skutočný termín. Výsledkom je mock rezervácia a — iba pri explicitne zapnutom SMS režime — reálna SMS na číslo volajúceho.

## Časť G — personalizovaný cold e-mail

Pred odoslaním nahraď `{{DEMO_TWILIO_NUMBER}}` novým dedikovaným demo číslom a doplň meno adresáta, ak ho máš overené.

**Predmet:** Krátke demo telefonického objednania pre Dental Centrum NIVY

```text
Dobrý deň,

na vašom webe som si všimol, že pacientom ponúkate online rezerváciu pre vybrané služby, no telefonické objednanie zostáva dostupné pre všetky služby.

Pripravili sme preto krátke demo PriXi virtuálnej asistentky priamo pre Dental Centrum NIVY. Volajúci si v ňom vyberie napríklad vstupné vyšetrenie, pohotovosť alebo dentálnu hygienu, zvolí preferovaný čas a potvrdí konkrétny termín — hlasom alebo tlačidlami na telefóne.

Demo si môžete nezáväzne vyskúšať na čísle {{DEMO_TWILIO_NUMBER}}. Je bezpečné: pracuje len s ukážkovými termínmi a nič nezapisuje do vášho rezervačného systému.

Ak vám bude dávať zmysel, rád vám v krátkom hovore ukážem, ako by rovnaký flow mohol zapisovať termíny priamo do vášho existujúceho systému.

Má zmysel 15-minútová ukážka budúci týždeň?

Matej
PriXi
```

## Záznam po každom ICP dema

Pre každý ďalší lead založ novú kópiu tejto checklisty a vyplň:

| Pole | Hodnota |
| --- | --- |
| Clinic / ICP | |
| Bot ID | |
| Demo Twilio číslo | |
| Webhook URL | |
| Zdrojový odkaz a dátum overenia | |
| Personalizačný insight | |
| Stav Render deployu | |
| Test hlasom / DTMF / odmietnutie / SMS | |
| E-mail predmet a finálna verzia | |
| Dátum odoslania a follow-up | |

