# watt

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | Français | [Español](README.es.md) | [Svenska](README.sv.md)

Claude Code n'affiche ni la durée de chaque appel d'outil, ni ce qu'il reste de votre usage sur cinq heures et sept jours,
ni ce que fait chaque sous-agent. watt dessine tout cela dans le terminal, à côté du prompt.

**[Démo en direct](https://ytsnipers.github.io/watt-mods/)** : un tour rejoué avec watt, dessiné par son propre code de rendu.

![watt dans un terminal Claude Code : durées des outils, ligne de tour, puces d'agents et barres de progression](../../docs/screenshot.png)

- **Durée des appels d'outil** : la ligne de chaque appel terminé se finit par sa durée, par exemple `took 1.2s`.
- **Ligne de tour** : sous la ligne de durée d'un tour principal, le contexte utilisé (rapporté à la fenêtre du modèle) et
  l'usage sur cinq heures et sept jours, en orange puis en rouge au-delà de leurs seuils.
- **Rangée des agents** : une rangée au-dessus du prompt avec une puce (un petit cadre d'état) par sous-agent en cours : son
  modèle, le temps écoulé et le remplissage du contexte. Une puce terminée passe au vert ou au rouge et reste quelques
  secondes, ou jusqu'à ce qu'on clique sur son ×.
- **Barres de progression** : pour le travail en plusieurs étapes, l'outil `plan_progress` dessine des barres d'étapes en
  direct au-dessus du prompt, pour voir où en est Claude (porté depuis [plan-progress](https://github.com/zycck/claude-mods),
  MIT, Kirill Serditov).
- **Sons** : un son discret quand un long tour ou tous les sous-agents se terminent, le son d'erreur quand quelque chose a
  échoué, et le son de décision quand Claude attend votre réponse.

## Prérequis

- Claude Code 2.1.295 ou plus récent (`claude --version`).
- Sous macOS, watt suit l'apparence claire ou sombre du système. Sur les autres plateformes, il dessine pour un fond sombre,
  sauf si le thème de `/config` est clair.

## Installation et suppression

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

```
/plugin uninstall watt@watt-mods
```

## Ce qu'il change dans le comportement de Claude

watt ne fait pas que dessiner. Avant de l'installer, sachez qu'il :

- **Ajoute une section au system prompt** de la conversation principale : les règles d'usage des barres de progression, un
  paragraphe d'environ 150 tokens à chaque requête. Les sous-agents ne la reçoivent pas.
- **Refuse une modification de fichier** : quand la conversation principale fait sa quatrième modification de fichier (Edit,
  Write, MultiEdit, NotebookEdit) sans barre de progression, cette modification est refusée une fois et Claude est invité à
  créer d'abord une barre. Les commandes shell et les sous-agents ne sont jamais refusés.
- **Ajoute de courts rappels** après les résultats d'outils quand une barre ouverte n'a pas été mise à jour depuis plusieurs
  modifications.
- **Renvoie Claude une fois à la fin d'un tour** qui a travaillé et laissé une barre ouverte sans vous poser de question :
  Claude fait un tour de plus pour mettre la barre à jour, ce qui consomme les tokens de ce tour. Un tour qui se termine par
  une question marque plutôt la barre comme en attente de votre réponse, et un tour qui attend un travail en arrière-plan
  se termine normalement.
- **Écrit un fichier local** : `~/.cache/claude-usage/usage-<hash>.json`, avec les pourcentages d'usage, affichés par
  l'application [CC Switch](https://github.com/farion1231/cc-switch). Rien n'est envoyé sur le réseau.

La liste complète de ce à quoi watt peut accéder se trouve dans [SECURITY.md](../../SECURITY.md) (en anglais).

## Réglages

| Commande | Ce qu'elle fait |
| --- | --- |
| `/watt-settings` | Active ou désactive le scintillement (points animés dans le remplissage des barres), les sons ou le modèle sur les puces ; règle combien de temps restent les puces et barres terminées. Les mêmes options se trouvent sous watt dans `/config`. |
| `/progress` | Masquer ou afficher les barres de progression |
| `/progress-clear` | Supprimer toutes les barres de progression |

## Dépannage

- **Pas d'outil `plan_progress` dans la session** : un filtre web d'antivirus (AVG Web Shield, par exemple) ou un proxy
  bloque 127.0.0.1, par où l'outil rejoint la session. Ajoutez 127.0.0.1 aux exceptions du filtre, ou définissez
  `NO_PROXY=127.0.0.1,localhost`, puis redémarrez Claude Code. Si ce n'est pas cela, vérifiez la version requise ci-dessus.
- **Les chiffres après la ligne de durée du tour manquent** : un autre mod a dessiné cette ligne sans la transmettre (le mod
  [prismantis](https://github.com/NahumLitvin/prismantis) le faisait avant la 0.50.0, voir
  [issue #601](https://github.com/NahumLitvin/prismantis/issues/601) ; mettre prismantis à jour règle le problème). Pour tout autre mod, chargez watt en premier en ajoutant ceci à
  `~/.claude/settings.json`, puis lancez `/reload-plugins` :

  ```json
  "prependPlugins": ["watt@watt-mods"]
  ```

## Développement

Lisez [AGENTS.md](../../AGENTS.md) (en anglais) pour l'organisation du code. Depuis `plugins/watt` :

```sh
claude plugin validate .
claude plugin test .
```

Après avoir modifié le code, lancez `/reload-plugins` dans Claude Code pour charger le changement.
