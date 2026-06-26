# Le Compagnon — ce que je sais faire

*Un compagnon local et privé qui vit sur ta machine (Ministar). Je t'entends, je te vois, je te parle,
je veille sur toi, je te tiens compagnie, et je travaille utilement quand tu n'es pas là. Tout tourne
en local ($0), et mon réglage par défaut, c'est **le silence** — je parle pour réchauffer, pas pour meubler.*

Tout est **opt-in** (rien ne s'active sans que tu le décides) et **honnête** : ce qui est prouvé est marqué,
ce qui demande du matériel/du temps pour se vivre aussi.

---

## Ce que je sais faire

### 🗣️ T'entendre et répondre comme un humain
J'écoute en continu (quand un micro est branché), mais je ne réponds que si **tu m'adresses la parole**
(mon nom, fuzzy-matché pour survivre à la transcription) ou si la conversation **m'y appelle vraiment** —
sinon je reste présent et silencieux. Je ne coupe jamais une conversation entre humains.
`respond-decider.ts` · `CODEBUDDY_SENSORY_SPEECH=true`, nom via `CODEBUDDY_ROBOT_NAME`.

### 🔊 Te parler — ici et à distance
Je réponds à voix haute (Piper, local) sur les **haut-parleurs intégrés**. Et quand tu es **absent**,
je peux t'envoyer ma voix en **note vocale Telegram** sur ton téléphone.
`voice-loop.ts` · `CODEBUDDY_SENSORY_SPEAK=true`, `CODEBUDDY_TTS_VOICE=…onnx`, `CODEBUDDY_VOICE_TO_TELEGRAM=true`.

### 👋 T'accueillir quand tu arrives
Quand la caméra te voit entrer (`person_entered`), je te salue — dans la voix et les mots de ma
personnalité active — et j'ouvre la conversation pour que tu me répondes.
`semantic-vision-reaction.ts` · `CODEBUDDY_SENSORY_GREET=true`.

### 🎭 Changer de personnalité et de voix
J'ai plusieurs personnalités (`/persona list|use <id>`) ; chacune a son **caractère**, son **nom** et sa
**voix `.onnx`**. Mon choix **tient entre les sessions**. Tu peux en créer (`~/.codebuddy/personas/*.json`).
`personas/persona-manager.ts`.

### 💊 Veiller sur tes rappels (médicaments…)
Je te rappelle au bon moment (voix + Telegram), tu confirmes « c'est fait » (à la voix, en sécurité — ça ne
se déclenche que sur un rappel réellement en attente), je re-rappelle doucement puis j'escalade si tu ne
réponds pas. Et un rappel déclenché **survit à un redémarrage** (jamais de dose perdue en silence).
`reminders.ts` · `buddy remind add "médicaments" --at 09:00 --daily` · `CODEBUDDY_REMINDERS=true`.

### 🪑 Te tenir compagnie (présence)
De temps en temps, au bon moment, je dis un petit mot qui réchauffe : *« comment s'est passée ta journée ? »*,
un encouragement si tu galères, *« tu veux faire une pause ? »*, un suivi de tes projets, bonjour/bonne soirée.
**Jamais** la nuit, jamais à une pièce vide, jamais en pleine conversation ; plafonné, et réglable.
`presence-loop.ts` · `CODEBUDDY_COMPANION_PRESENCE=true`.

### 🌙 Travailler utilement quand tu es seul (et sûr par construction)
Quand tu n'es pas là, je dépose des **artefacts à relire** (« voilà ce que j'ai remarqué/préparé ») dans
`~/.codebuddy/companion/idle-log.jsonl` : journal du jour, **état du repo en lecture seule**, brief du matin.
Je n'agis sans toi que sur une **liste fermée de gestes sûrs** (ranger le disque, écrire un brouillon,
status read-only…). **Jamais** de git push / PR, **jamais** de boucle de tests non bornée, **jamais** de
modèle payant. Tout le reste reste une **suggestion**, pas une action.
`idle-loop.ts` · `CODEBUDDY_COMPANION_IDLE=true`.

### 🛠️ Être administré
Tu pilotes mes rappels et mes **règles déclenchables** (event → action) en CLI (`buddy remind`, `buddy rules`)
ou dans le panneau **Automatisations** de Cowork. Les règles se **rechargent à chaud** (pas de redémarrage).
`sensory-rules-engine.ts`, `reminders.ts`.

### 🛰️ Collaborer avec mes autres machines (Fleet)
Plusieurs Code Buddy sur ton réseau peuvent réfléchir ensemble : `buddy council --fleet` pose une question à
toutes les machines connectées et réconcilie les réponses. Auth par token : `buddy fleet token`.
`fleet/…`, `commands/council.ts` · recette : `docs/fleet-guide.md`.

---

## Me réveiller (tout en même temps)
```bash
JWT_SECRET=… \
CODEBUDDY_SENSORY=true CODEBUDDY_SENSORY_SPEECH=true CODEBUDDY_SENSORY_SPEAK=true \
CODEBUDDY_TTS_VOICE=/home/patrice/DEV/ai-stack/voice/voices/fr_FR-siwis-medium.onnx \
CODEBUDDY_SENSORY_GREET=true CODEBUDDY_COMPANION_PRESENCE=true CODEBUDDY_COMPANION_IDLE=true \
CODEBUDDY_REMINDERS=true \
buddy server
# + buddy-vision (la caméra) pour qu'il te voie. Sortie son = haut-parleurs intégrés (groupe `audio`).
```
Réglages utiles : `CODEBUDDY_COMPANION_QUIET=22-8` (heures calmes), `CODEBUDDY_COMPANION_PRESENCE_HOURLY_CAP`,
`CODEBUDDY_COMPANION_IDLE_HOURLY_CAP`, `CODEBUDDY_ROBOT_NAME`, `CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT` (Telegram).

## Ce que je ne sais pas encore faire (honnête)
- **Écoute micro live** : `buddy-sense` lit du WAV, la capture micro continue (cpal/VAD) reste à brancher
  (le DMIC intégré de la machine la débloque).
- **Idle, couche riche** : digest d'actualités aux repas, brouillons de blog, lancer les tests + proposer des
  fixes — différés (zone coût/ressources/action sortante).
- **Bouton "Fait" Telegram**, **fleet Tailscale réel 3 machines**, **Cowork "voice can act"** — câblés en partie.

## Comment je reste discret et sûr
Opt-in partout (défaut OFF) · défaut = **silence** · jamais la nuit · jamais à une pièce vide · jamais en
pleine conversation humaine · plafonds horaires · quand je suis seul, je **propose**, je n'agis que sur une
liste fermée de gestes réversibles · $0 local, jamais de modèle payant sans toi.
