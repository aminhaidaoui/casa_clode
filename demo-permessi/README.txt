CASA NOSTRA — DEMO PERMESSI

Questa demo è separata dal sito principale e non invia alcun dato su Internet.

COME PROVARLA

1. Aprire PowerShell nella cartella della demo.
2. Avviare un server locale, per esempio:
   py -m http.server 8080
3. Visitare nel browser:
   http://localhost:8080

Il browser considera localhost un contesto adatto alle API protette. Aprendo invece
il file index.html con un doppio clic, fotocamera o posizione potrebbero non funzionare.

COSA MOSTRA

- Il pulsante "Entra a Casa Nostra" registra data e ora.
- Il browser chiede separatamente il permesso per la posizione.
- La fotocamera frontale o posteriore si apre solo dopo un'azione esplicita.
- La fotografia viene mostrata in anteprima.
- L'invio Telegram è simulato nel riquadro JSON.
- Chiudendo la pagina, la fotocamera viene arrestata.

PER LA VERSIONE REALE

Serve un endpoint protetto esterno a GitHub Pages. Il token Telegram deve essere
conservato come segreto lato server e non deve comparire nell'HTML o nel repository.
