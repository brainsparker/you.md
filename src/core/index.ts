export { discoverProfilePath, getDefaultSearchPaths } from "./discovery";
export { mergeProfiles } from "./merger";
export { validateProfile, isValidProfile } from "./validator";
export { formatProfileForContext, type FormattableProfile } from "./formatter";
export {
  scopeProfile,
  findDirective,
  parseAudienceRule,
  stripDirectives,
  audienceIncludes,
  expandAudiences,
  audienceNames,
  unknownAudiences,
  describeRule,
  AUDIENCE_GROUPS,
  KNOWN_TARGET_IDS,
  MCP_TARGET_ID,
  type AudienceRule,
  type AudienceGroup,
  type ScopeResult,
  type WithheldSection,
} from "./audience";
