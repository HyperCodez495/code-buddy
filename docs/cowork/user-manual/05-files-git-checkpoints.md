# 5. Fichiers, Git & checkpoints

Tout ce qui concerne le code que l'agent touche vit dans le **panneau de contexte** (à droite). Ce
chapitre couvre le parcours des fichiers, la relecture des changements, les commits et l'annulation.

## 5.1 Parcourir & prévisualiser les fichiers

- L'onglet **Fichiers** montre l'espace de travail en arborescence. Cliquez un fichier pour ouvrir
  l'**aperçu** : code coloré, images inline, nombre de pages PDF + texte extrait, ou métadonnées pour
  les binaires.
- Utilisez la disposition en deux volets (`Cmd/Ctrl+\`) pour garder un aperçu à côté du chat.
- La vue **File activity** donne une timeline des fichiers modifiés pendant la session.

> _[capture : onglet Fichiers + aperçu]_

## 5.2 Relire les changements (diffs)

Quand l'agent édite des fichiers, l'onglet **Diffs** montre un diff unifié par fichier — lignes
ajoutées, retirées, et de contexte par hunk. Vous pouvez relire chaque changement avant de le garder,
et annuler les hunks dont vous ne voulez pas. Des aperçus de diff inline apparaissent aussi
directement dans les résultats d'outils du chat.

> _[capture : visionneuse de diff]_

## 5.3 Git

L'onglet **Git** est un client léger pour le dépôt de l'espace de travail :

- Voir la **branche courante** et l'avance/retard par rapport au remote.
- Fichiers groupés en **stagés / modifiés / non suivis** ; stager ou unstager individuellement.
- Ouvrir le **composer de commit** pour écrire un message et committer.
- Un **sélecteur de branche** permet de changer de branche sans quitter Cowork.

> _[capture : onglet Git avec des changements stagés]_

## 5.4 Checkpoints — annuler, restaurer, comparer

Cowork prend des snapshots de votre espace de travail pendant que l'agent travaille, pour revenir en
arrière sans risque. L'onglet **Checkpoints** offre :

- **Annuler / Rétablir** dans l'historique des snapshots.
- Vues **Liste** et **Timeline** de tous les checkpoints (chacun avec description et horodatage).
- **Restaurer** — cliquez un checkpoint pour ramener l'espace de travail à cet état.
- **Comparer** — sélectionnez deux checkpoints pour voir le diff entre eux.

Comme chaque checkpoint est un vrai snapshot, vous pouvez laisser l'agent faire des changements
audacieux et revenir à n'importe quel point antérieur en un clic.

> _[capture : timeline des checkpoints + comparaison]_

## 5.5 Artifacts

Quand l'agent produit une sortie autonome — HTML, un SVG, un diagramme Mermaid, du JSON, un document
généré — elle apparaît comme un **artifact**. La vue artifact permet de basculer entre **Aperçu** et
**Source**, de copier la source, et de télécharger le fichier. Les aperçus HTML/SVG sont isolés dans
une iframe par sécurité.

> _[capture : aperçu/source d'un artifact]_
