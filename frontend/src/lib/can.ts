// Dotted-permission matcher, ported from V1's usePermissions logic.
//   '*'                      -> holds every permission
//   required 'namespace.*'   -> satisfied by holding ANY permission in that
//                               namespace ('database.read' satisfies 'database.*'),
//                               which is how the nav gates whole sections
//   held 'namespace.*'       -> grants every permission in that namespace
//   exact string             -> direct match
// `held` is the set of permission strings the user/subuser owns.
export function can(held: string[], required: string | string[] | undefined): boolean {
    if (!required || (Array.isArray(required) && required.length === 0)) return true;
    if (held.includes('*')) return true;

    const wanted = Array.isArray(required) ? required : [required];
    return wanted.some(permission => {
        if (held.includes(permission)) return true;

        if (permission.endsWith('.*')) {
            const namespace = permission.slice(0, -2);
            return held.some(p => p.startsWith(`${namespace}.`));
        }

        const namespace = permission.split('.')[0];
        return held.includes(`${namespace}.*`);
    });
}
