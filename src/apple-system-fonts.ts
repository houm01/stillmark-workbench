export interface SystemFontFamily {
    displayName: string;
    family: string;
}

export interface SystemFontFace extends SystemFontFamily {
    weight: number;
}

interface AppleFontFamily extends SystemFontFamily {
    aliases: string[];
}

const PINGFANG_FAMILIES: AppleFontFamily[] = [
    {family: "PingFang SC", displayName: "苹方-简", aliases: ["PingFang SC", "苹方-简"]},
    {family: "PingFang TC", displayName: "苹方-繁", aliases: ["PingFang TC", "苹方-繁"]},
    {family: "PingFang HK", displayName: "苹方-港", aliases: ["PingFang HK", "苹方-港"]},
    {family: "PingFang MO", displayName: "苹方-澳", aliases: ["PingFang MO", "苹方-澳"]},
];

const PINGFANG_WEIGHTS = [
    {name: "极细体", weight: 100},
    {name: "纤细体", weight: 200},
    {name: "细体", weight: 300},
    {name: "常规体", weight: 400},
    {name: "中黑体", weight: 500},
    {name: "中粗体", weight: 600},
];

export function addAppleSystemFontFamilies(fonts: SystemFontFamily[]) {
    if (!isApplePlatform()) {
        return fonts;
    }

    const existingFamilies = new Set(fonts.map((font) => canonicalFamily(font.family)));
    const additions = PINGFANG_FAMILIES.filter((font) => !existingFamilies.has(canonicalFamily(font.family)))
        .map(({family, displayName}) => ({family, displayName}));
    return [...additions, ...fonts];
}

export function addAppleSystemFontFaces(fonts: SystemFontFace[]) {
    if (!isApplePlatform()) {
        return fonts;
    }

    const existingFaces = new Set(fonts.map((font) => `${canonicalFamily(font.family)}\u0000${font.weight}`));
    const additions = PINGFANG_FAMILIES.flatMap((font) =>
        PINGFANG_WEIGHTS.flatMap((weight) => {
            const key = `${canonicalFamily(font.family)}\u0000${weight.weight}`;
            if (existingFaces.has(key)) {
                return [];
            }
            return [{
                family: font.family,
                displayName: `${font.displayName} ${weight.name}`,
                weight: weight.weight,
            }];
        })
    );
    return [...additions, ...fonts];
}

function canonicalFamily(family: string) {
    const normalizedFamily = family.trim().toLocaleLowerCase();
    const pingFangFamily = PINGFANG_FAMILIES.find((font) =>
        font.aliases.some((alias) => alias.toLocaleLowerCase() === normalizedFamily)
    );
    return pingFangFamily?.family.toLocaleLowerCase() ?? normalizedFamily;
}

function isApplePlatform() {
    return /Macintosh|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
