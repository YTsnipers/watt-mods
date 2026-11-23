// What the demo page calls: watt's own drawing code, bundled for the browser by build.sh.
import { chipCells, trackCells, chipTint, hexOf } from '../../plugins/watt/hooks/raster'
import { barCells, live, glide } from '../../plugins/watt/hooks/track'
import { where, percent, STATE_COLOR, STATE_GLYPH } from '../../plugins/watt/hooks/plan'
import { setThemeSetting } from '../../plugins/watt/hooks/tint'
import { prefs } from '../../plugins/watt/hooks/prefs'
;(globalThis as any).watt = { chipCells, trackCells, chipTint, hexOf, barCells, live, glide, where, percent, STATE_COLOR, STATE_GLYPH, setThemeSetting, prefs }
