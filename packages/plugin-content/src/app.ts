// The app a collection renders for. Collections are read from route modules, not through the plugin, so each read asks prunelle which app the current request or build belongs to.

import type { ContentImageResolver } from 'prunelle/config'
import { CONTENT_IMAGE_RESOLVER_SERVICE, I18N_CONFIG_SERVICE } from 'prunelle/config'
import { getAppContext } from 'prunelle/internal/server'

export const currentApp = {
  root: (): string | undefined => getAppContext()?.root,
  site: (): string | undefined => getAppContext()?.site,
  dev: (): boolean | undefined => getAppContext()?.dev,
  defaultLocale: (): string | undefined => getAppContext()?.inject(I18N_CONFIG_SERVICE)?.defaultLocale,
  imageResolver: (): ContentImageResolver | undefined => getAppContext()?.inject(CONTENT_IMAGE_RESOLVER_SERVICE),
}
