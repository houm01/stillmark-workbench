export interface MindMapTreeNode {
    branch: number;
    children: MindMapTreeNode[];
    depth: number;
    id: string;
    level: number;
    title: string;
}

export interface MindMapNodeSize {
    height: number;
    width: number;
}

export interface PositionedMindMapNode {
    height: number;
    node: MindMapTreeNode;
    width: number;
    x: number;
    y: number;
}

export interface MindMapEdge {
    source: PositionedMindMapNode;
    target: PositionedMindMapNode;
}

export interface MindMapLayout {
    edges: MindMapEdge[];
    height: number;
    nodes: PositionedMindMapNode[];
    width: number;
}

const DEFAULT_NODE_SIZE: MindMapNodeSize = {height: 54, width: 190};
const HORIZONTAL_GAP = 92;
const ROOT_HORIZONTAL_GAP = 116;
const VERTICAL_GAP = 18;
const WORLD_PADDING = 52;

export function layoutMindMap(
    root: MindMapTreeNode,
    nodeSizes: ReadonlyMap<string, MindMapNodeSize>,
    collapsedNodeIds: ReadonlySet<string>,
): MindMapLayout {
    const visibleNodes = flattenVisibleNodes(root, collapsedNodeIds);
    const widthByDepth = new Map<number, number>();
    visibleNodes.forEach((node) => {
        const width = nodeSizes.get(node.id)?.width ?? DEFAULT_NODE_SIZE.width;
        widthByDepth.set(node.depth, Math.max(widthByDepth.get(node.depth) ?? 0, width));
    });

    const xByDepth = new Map<number, number>([[0, WORLD_PADDING]]);
    const maximumDepth = Math.max(...visibleNodes.map((node) => node.depth), 0);
    for (let depth = 1; depth <= maximumDepth; depth += 1) {
        const previousX = xByDepth.get(depth - 1) ?? WORLD_PADDING;
        const previousWidth = widthByDepth.get(depth - 1) ?? DEFAULT_NODE_SIZE.width;
        xByDepth.set(
            depth,
            previousX + previousWidth + (depth === 1 ? ROOT_HORIZONTAL_GAP : HORIZONTAL_GAP),
        );
    }

    const subtreeHeights = new Map<string, number>();
    const measureSubtree = (node: MindMapTreeNode): number => {
        const ownHeight = nodeSizes.get(node.id)?.height ?? DEFAULT_NODE_SIZE.height;
        const children = collapsedNodeIds.has(node.id) ? [] : node.children;
        const childrenHeight = children.reduce((total, child, index) => {
            return total + measureSubtree(child) + (index > 0 ? VERTICAL_GAP : 0);
        }, 0);
        const height = Math.max(ownHeight, childrenHeight);
        subtreeHeights.set(node.id, height);
        return height;
    };

    const rootSubtreeHeight = measureSubtree(root);
    const positionedNodes: PositionedMindMapNode[] = [];
    const positionedById = new Map<string, PositionedMindMapNode>();

    const positionSubtree = (node: MindMapTreeNode, top: number) => {
        const size = nodeSizes.get(node.id) ?? DEFAULT_NODE_SIZE;
        const subtreeHeight = subtreeHeights.get(node.id) ?? size.height;
        const positioned: PositionedMindMapNode = {
            height: size.height,
            node,
            width: size.width,
            x: xByDepth.get(node.depth) ?? WORLD_PADDING,
            y: top + (subtreeHeight - size.height) / 2,
        };
        positionedNodes.push(positioned);
        positionedById.set(node.id, positioned);

        if (collapsedNodeIds.has(node.id)) {
            return;
        }
        const childrenHeight = node.children.reduce((total, child, index) => {
            return total + (subtreeHeights.get(child.id) ?? DEFAULT_NODE_SIZE.height) +
                (index > 0 ? VERTICAL_GAP : 0);
        }, 0);
        let childTop = top + (subtreeHeight - childrenHeight) / 2;
        node.children.forEach((child) => {
            positionSubtree(child, childTop);
            childTop += (subtreeHeights.get(child.id) ?? DEFAULT_NODE_SIZE.height) + VERTICAL_GAP;
        });
    };

    positionSubtree(root, WORLD_PADDING);
    const edges: MindMapEdge[] = [];
    positionedNodes.forEach((target) => {
        if (target.node.depth === 0) {
            return;
        }
        const parent = findVisibleParent(root, target.node.id, collapsedNodeIds);
        const source = parent ? positionedById.get(parent.id) : undefined;
        if (source) {
            edges.push({source, target});
        }
    });

    const width = positionedNodes.reduce(
        (maximum, node) => Math.max(maximum, node.x + node.width),
        0,
    ) + WORLD_PADDING;
    return {
        edges,
        height: rootSubtreeHeight + WORLD_PADDING * 2,
        nodes: positionedNodes,
        width,
    };
}

function flattenVisibleNodes(
    root: MindMapTreeNode,
    collapsedNodeIds: ReadonlySet<string>,
): MindMapTreeNode[] {
    const nodes = [root];
    if (!collapsedNodeIds.has(root.id)) {
        root.children.forEach((child) => nodes.push(...flattenVisibleNodes(child, collapsedNodeIds)));
    }
    return nodes;
}

function findVisibleParent(
    root: MindMapTreeNode,
    targetId: string,
    collapsedNodeIds: ReadonlySet<string>,
): MindMapTreeNode | undefined {
    if (collapsedNodeIds.has(root.id)) {
        return undefined;
    }
    for (const child of root.children) {
        if (child.id === targetId) {
            return root;
        }
        const parent = findVisibleParent(child, targetId, collapsedNodeIds);
        if (parent) {
            return parent;
        }
    }
    return undefined;
}
