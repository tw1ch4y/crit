# Šabloni za dizajn

Devet SVG šablona u tačnim dimenzijama. Otvori šablon u alatu za dizajn kao
donji sloj, crtaj preko njega, pa izvezi **samo svoj crtež** (bez šablona).

Zone su izmerene iz stvarnog launchera, nisu procenjene.

| Boja zone | Značenje |
|---|---|
| **crvena** | sadržaj launchera stoji preko slike, tu se ništa neće videti |
| **zelena** | tu stavi ono što mora da se vidi |
| siva mreža | trećine, za lakše komponovanje |

## Spisak

| Fajl | Dimenzija | Gde ide |
|---|---|---|
| `1-pozadina-PRIJAVA` | 2560x1440 | Izgled launchera > Ekran za prijavu |
| `2-pozadina-POCETNA` | 2560x1440 | Izgled launchera > Početna |
| `3-pozadina-SHOP` | 2560x1440 | Izgled launchera > Shop |
| `4-pozadina-NALOG` | 2560x1440 | Izgled launchera > Nalog |
| `5-pozadina-ZAKLJUCAN` | 2560x1440 | Izgled launchera > Zaključan ekran |
| `6-PROMO-BANER` | 2200x200 | Izgled launchera > Promo baneri |
| `7-OMOT-IGRE` | 600x800 | Igre > izmena igre > Omot |
| `8-BANER-IGRE` | 2800x400 | Igre > izmena igre > Baner (rezervna pozadina prijave) |
| `9-SLIKA-PRECICE` | 256x256 | Internet alati > izmena > Slika |

## Pravila koja važe za sve

- **Format:** JPG ili WEBP. PNG samo ako slika ima providnost.
- **Najviše 8 MB** po slici.
- **Tamnije je bolje.** Preko svake pozadine ide tamni sloj da tekst ostane
  čitljiv, ali svetla slika i dalje pravi problem.
- **Bez sitnog teksta** na pozadinama. Gubi se ispod sadržaja.

## Zašto promo baner nije 16:9

Traka na vrhu početne je **veoma široka i niska**, i deli se na dva dela: levo
stoji promo baner (ili znak igraonice ako banera nema), desno nagradni točak.
Prostor za baner je oko **11:1**, zato je šablon 2200x200.

Baner se u tu traku **uklapa, ne razvlači** - ništa se ne seče ni na jednoj
rezoluciji. Ako nacrtaš u drugom odnosu, slika i dalje radi, samo sa strane
ostanu tamne ivice. Zato se isplati držati 11:1.

## Tekstura se ne crta, bira se

Sitna šara koja se ponavlja preko celog ekrana **nije slika i ne kači se**.
Bira se u panelu, pod *Izgled launchera > Tekstura pozadine*.

Deset šara: tačkice, zvezdice, praskovi, kose linije, **kockice d20**, saće,
munje, **CRIT**, rombovi - i „bez teksture".

Launcher ih crta sam, pa su oštre na svakoj rezoluciji i ne troše ništa. Stoje
**iznad** okačene pozadine, znači rade i na praznoj pozadini i preko tvoje slike.

Ako praviš pozadinu koja već ima svoju šaru, isključi teksturu - inače se dve
šare sabiraju i ekran postane nemiran.

### Kretanje

| Način | Šta radi |
|---|---|
| **Mirno** | šara stoji |
| **Klizanje** | polako putuje po dijagonali |
| **Talas** | šara stoji, preko nje prelazi pojas svetla |
| **Dubina** | dva sloja, bliži prati pokret miša |
| **Iskre** | pojedine figure se upale u crveno pa se vrate |

Sve je namerno sporo - stoji ceo dan iza igara i ne sme da vuče pogled. Računar
koji na sistemskom nivou traži manje animacija ih ni ne dobija.

### Igrač može da izabere svoju

Na *Nalogu* u launcheru, pod **Moja pozadina**, igrač bira svoju šaru, jačinu i
kretanje. To važi **samo dok je on prijavljen** - kad se odjavi, računar se
vraća na ono što si ti podesio. Izbor prati nalog, pa ga zatekne i kad sutra
sedne za drugi računar.

Kad ti promeniš kućnu šaru, igraču koji ima svoju se ne menja ništa.

## Razlika: pozadine i promo baner

**Pozadine** stoje iza sadržaja i preko njih uvek ide tamni sloj. Tu idu
teksture, gradijenti, prigušene fotografije.

**Promo baner** je suprotno: preko njega launcher **ne crta ništa**. Sve što
treba da piše mora da bude na samoj slici. Tu ide CRIT logo, poruka, akcija.
Kad okačiš više banera, smenjuju se sami na 8 sekundi i dobiju tačkice dole
desno. Redosled se menja strelicama u panelu.

Dok nema nijednog promo banera, na vrhu početne stoji izdvojena igra.

## Ako promeniš raspored launchera

Zone se generišu iz merenja. Pokreni ponovo:

```
node assets/napravi-sablone.mjs
```
