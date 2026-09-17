export { discoverProfilePath, getDefaultSearchPaths } from "./discovery";
export { mergeProfiles } from "./merger";
export { validateProfile, isValidProfile } from "./validator";
export { formatProfileForContext, type FormattableProfile } from "./formatter";
export {
  resolveExtendsTarget,
  canonicalSourceKey,
  remoteExtendsAllowed,
  maxExtendsDepth,
  type ProfileSource,
  type ResolveExtendsTargetResult,
} from "./inheritance";
