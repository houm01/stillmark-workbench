import {outlinePdfFactory} from "@lillallol/outline-pdf";
import * as pdfLib from "pdf-lib";

const OUTLINE_URI_PREFIX = "pdf-outline://";

export interface PdfOutlineHeading {
    id: string;
    level: number;
    title: string;
}

export async function addPdfOutline(pdfBytes: Uint8Array, headings: PdfOutlineHeading[]) {
    const pdfDocument = await pdfLib.PDFDocument.load(pdfBytes, {updateMetadata: false});
    const pageByHeadingId = new Map<string, number>();

    pdfDocument.getPages().forEach((page, pageIndex) => {
        const annotations = page.node.Annots();
        if (!annotations) {
            return;
        }
        for (let index = annotations.size() - 1; index >= 0; index -= 1) {
            const uri = getAnnotationUri(pdfDocument, annotations.get(index));
            if (!uri?.startsWith(OUTLINE_URI_PREFIX)) {
                continue;
            }
            const headingId = uri.slice(OUTLINE_URI_PREFIX.length).replace(/\/$/, "");
            if (headingId && !pageByHeadingId.has(headingId)) {
                pageByHeadingId.set(headingId, pageIndex + 1);
            }
            annotations.remove(index);
        }
    });

    const mappedHeadings = headings.filter((heading) => pageByHeadingId.has(heading.id));
    if (mappedHeadings.length === 0) {
        throw new Error("No PDF outline destinations were generated");
    }

    const levelStack: number[] = [];
    const outline = mappedHeadings.map((heading) => {
        while (levelStack.length > 0 && levelStack[levelStack.length - 1] >= heading.level) {
            levelStack.pop();
        }
        const depth = levelStack.length;
        levelStack.push(heading.level);
        const page = pageByHeadingId.get(heading.id);
        const title = heading.title.replaceAll("|", "｜").replace(/[\r\n]+/g, " ").trim();
        return `${page}|${"-".repeat(depth)}|${title}`;
    }).join("\n");

    const addOutline = outlinePdfFactory(pdfLib);
    await addOutline({outline, pdf: pdfDocument});
    pdfDocument.catalog.set(pdfLib.PDFName.of("PageMode"), pdfLib.PDFName.of("UseOutlines"));
    return pdfDocument.save();
}

function getAnnotationUri(pdfDocument: pdfLib.PDFDocument, annotationObject: pdfLib.PDFObject) {
    const annotation = pdfDocument.context.lookup(annotationObject, pdfLib.PDFDict);
    const action = annotation?.lookupMaybe(pdfLib.PDFName.of("A"), pdfLib.PDFDict);
    const uri = action?.lookupMaybe(
        pdfLib.PDFName.of("URI"),
        pdfLib.PDFString,
        pdfLib.PDFHexString,
    );
    return uri?.decodeText();
}
