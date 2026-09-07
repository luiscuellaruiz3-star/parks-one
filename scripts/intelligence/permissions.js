export const Scopes={ARCHITECT:'architect',OPS:'operations',REGIONAL:'regional',ADMIN:'admin'};
export function can(scope,action){
 const m={architect:['*'],operations:['*'],regional:['read','approve_region'],admin:['read','own_region']};
 return m[scope]?.includes('*')||m[scope]?.includes(action);
}