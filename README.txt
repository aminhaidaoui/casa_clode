CASA NOSTRA — versione pulita (basata su V21, tema Warm rosa/bordeaux)

Cosa è cambiato rispetto al file originale:

BUG SISTEMATI
- Il countdown al 20 luglio e il lucchetto della "stanza" non funzionavano
  per niente (variabile OPEN_AT mai definita, errore JS silenzioso). Ora
  la data è impostata al 20/07/2026 e tutto funziona.
- Il bottone "entra a casa nostra" restava bloccato per 8-9 secondi durante
  l'animazione iniziale. Ora si può toccare lo schermo in qualsiasi momento
  per saltare l'intro.
- La sezione "come ti senti oggi, patatina?" appariva PRIMA della hero,
  ancora prima che il sito si aprisse davvero. Ora è nella sua posizione
  naturale, subito dopo l'apertura.
- C'era una seconda sezione "come ti senti" identica ma vuota/rotta più in
  basso nella pagina. Rimossa.

TEMA
- Scelto il tema caldo rosa/bordeaux (era in conflitto con un tema
  "metallic ice blue" sovrapposto per errore nelle versioni successive).

RESPONSIVE / MOBILE
- Aggiunto supporto alla "safe area" di iPhone (notch / home indicator)
  cosi elementi fissi non vengono coperti.
- Aggiunto un breakpoint dedicato per iPad (tra desktop e mobile).
- Migliorata l'affidabilità del gesto "tieni premuto" sulla galassia su
  touchscreen (evita che lo scroll interferisca).
- Aggiunto testo alternativo (alt) alle immagini.

PULIZIA CODICE
- Rimosse ~200 righe di CSS/JS "morto": regole di versioni precedenti
  (V16, V17, V18, V19) che non avevano più nessun elemento HTML a cui
  applicarsi e non producevano alcun effetto visibile.
- Il file è più leggero e molto più facile da modificare in futuro.

DA FARE PRIMA DI PUBBLICARE
- Aggiungere le restanti foto/video (vedi chat per consigli su
  compressione e hosting dei video, visto che sono ~220 file).
