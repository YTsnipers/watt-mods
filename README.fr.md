# watt-mods

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | Français | [Español](README.es.md) | [Svenska](README.sv.md)

Des mods Claude Code par apollon. Chaque mod s'ajoute à l'interface même de Claude Code : ce qu'elle affiche à côté du
prompt et, dans certains cas, la façon dont Claude travaille.

**[Démo en direct](https://ytsnipers.github.io/watt-mods/)** : un tour rejoué avec watt, dessiné par son propre code de rendu.

![watt dans un terminal Claude Code : durées des outils, ligne de tour, puces d'agents et barres de progression](docs/screenshot.png)

| Mod | Ce qu'il fait |
| --- | --- |
| [watt](plugins/watt/README.fr.md) | Montre ce que Claude Code laisse caché : la durée de chaque appel d'outil, le contexte et l'usage sur cinq heures et sept jours après chaque tour, une puce d'état par sous-agent en cours et des barres de progression en direct au-dessus du prompt, avec des sons discrets quand le travail se termine, échoue ou vous attend. Il demande aussi à Claude de tenir une barre de progression pour le travail en plusieurs étapes ; voir [ce qu'il change dans le comportement de Claude](plugins/watt/README.fr.md#ce-quil-change-dans-le-comportement-de-claude). |

## Installation

Dans Claude Code (2.1.295 ou plus récent) :

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

Les réglages, le dépannage et la désinstallation sont décrits dans le [README de watt](plugins/watt/README.fr.md).

## Sécurité

[SECURITY.md](SECURITY.md) (en anglais) liste tout ce à quoi watt peut accéder (aucun réseau, un fichier local, deux
commandes locales fixes) et explique comment signaler une vulnérabilité.

## Licence

MIT, voir [LICENSE](LICENSE). watt inclut du code adapté de plan-progress (MIT) ; voir
[plugins/watt/NOTICE](plugins/watt/NOTICE).
