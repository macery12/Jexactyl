// Browser translation tools (Google Translate, the browser's built-in "Translate
// this page", and several privacy/ad extensions) rewrite the text nodes React
// manages — wrapping or replacing them with <font> tags or clones. When React
// later reconciles and calls removeChild/insertBefore on a node the extension has
// already moved out from under it, the DOM throws
//   NotFoundError: Failed to execute 'removeChild' on 'Node':
//   The node to be removed is not a child of this node.
// which unwinds and tears down the whole React tree. The crash looks random (it
// depends on which nodes were translated and exactly when React next re-renders
// them) and hits every page, because translation runs against the entire body.
//
// This hardens the two Node methods React uses during commit so a parent-mismatch
// is recovered from instead of thrown. It only intervenes when the child's real
// parent disagrees with the call — every normal React commit takes the original
// path untouched. Well-known community mitigation; see facebook/react#11538.
export function installDomGuard(): void {
    if (typeof Node !== 'function' || (Node.prototype as { __m12DomGuard?: boolean }).__m12DomGuard) {
        return;
    }
    (Node.prototype as { __m12DomGuard?: boolean }).__m12DomGuard = true;

    const originalRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
        if (child.parentNode !== this) {
            // The extension already detached (or re-parented) the node. Complete
            // React's intent against the real parent instead of throwing.
            if (child.parentNode) child.parentNode.removeChild(child);
            return child;
        }
        return originalRemoveChild.call(this, child) as T;
    } as typeof Node.prototype.removeChild;

    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(
        this: Node,
        newNode: T,
        referenceNode: Node | null,
    ): T {
        if (referenceNode && referenceNode.parentNode !== this) {
            // The reference sibling was moved by the extension; appending keeps
            // React's node in the tree rather than crashing on the bad anchor.
            return originalInsertBefore.call(this, newNode, null) as T;
        }
        return originalInsertBefore.call(this, newNode, referenceNode) as T;
    } as typeof Node.prototype.insertBefore;
}
