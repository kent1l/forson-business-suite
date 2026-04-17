const trimCommitSha = (sha) => (sha && sha !== 'local' ? sha.slice(0, 7) : 'local')

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
export const APP_COMMIT_SHA = trimCommitSha(typeof __APP_COMMIT_SHA__ !== 'undefined' ? __APP_COMMIT_SHA__ : 'local')
export const APP_BUILD_DATE = typeof __APP_BUILD_DATE__ !== 'undefined' ? __APP_BUILD_DATE__ : null

export const APP_VERSION_LABEL = `v${APP_VERSION}`
