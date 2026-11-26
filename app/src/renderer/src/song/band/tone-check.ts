// Whether a song's tone files are really there (spec 136). A bass or drum tone chain names captures and IRs that are downloaded files. When
// one is missing, Generate falls back to a clean part. That is fine when the performer asks for it, but an automatic update must never swap a
// good rendered part for a clean one, and a playlist should say before the show which songs would sound different.

import type { BandSettings, PartToneFile, ToneBlock, ToneRole, TonePart } from "./arrangement";
import type { PartToneFiles } from "./part-tone";

/** A file a tone chain needs that cannot be read on this computer. */
export interface MissingToneFile {
  part: TonePart;
  role: ToneRole;
  /** A capture (NAM) or an impulse response. */
  type: ToneBlock["type"];
  file: PartToneFile;
}

const PART_LABEL: Record<TonePart, string> = { bass: "bass", drums: "drum" };
const PARTS: readonly TonePart[] = ["bass", "drums"];

/** "amp capture" or "cab IR": what a block's file is called in a sentence. */
export const fileLabel = (missing: Pick<MissingToneFile, "role" | "type">): string => `${missing.role} ${missing.type === "capture" ? "capture" : "IR"}`;

async function exists(block: ToneBlock & { file: PartToneFile }, files: PartToneFiles): Promise<boolean> {
  const { file } = block;
  try {
    if (file.source === "tone3000") {
      if (file.toneId === undefined || file.modelId === undefined) return false;
      if (block.type === "capture") await files.readNam(file.toneId, file.modelId);
      else await files.readIr(file.toneId);
    } else {
      if (file.path === undefined) return false;
      if (block.type === "capture") await files.readLocalNam(file.path);
      else await files.readLocalIr(file.path);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The chain files of the bass and drum tones that cannot be read. Only blocks that are on and have a file count, as in loadPartTone: an
 * empty slot or an off block plays nothing, so it cannot be missing.
 */
export async function missingToneFiles(settings: Pick<BandSettings, "bassTone" | "drumTone">, files: PartToneFiles): Promise<MissingToneFile[]> {
  const missing: MissingToneFile[] = [];
  for (const part of PARTS) {
    const tone = part === "bass" ? settings.bassTone : settings.drumTone;
    if (tone.kind !== "chain") continue;
    for (const block of tone.blocks) {
      if (!block.on || !block.file) continue;
      if (!(await exists({ ...block, file: block.file }, files))) missing.push({ part, role: block.role, type: block.type, file: block.file });
    }
  }
  return missing;
}

/** "the bass tone's amp capture is missing", or "the bass tone's amp capture and cab IR are missing". One clause per part. */
function clauses(missing: readonly MissingToneFile[]): string[] {
  return PARTS.flatMap((part) => {
    const own = missing.filter((entry) => entry.part === part).map(fileLabel);
    if (own.length === 0) return [];
    const names = own.length > 1 ? `${own.slice(0, -1).join(", ")} and ${own.at(-1)}` : own[0];
    return [`the ${PART_LABEL[part]} tone's ${names} ${own.length > 1 ? "are" : "is"} missing`];
  });
}

/** The notice for an automatic update that did not run, because a tone file is missing. */
export function notUpdatedMessage(missing: readonly MissingToneFile[]): string {
  return `Not updated: ${clauses(missing).join(", and ")}. Download it or switch to Clean, then Generate.`;
}

/**
 * The reason an automatic update must not run, or null when it may. The stored audio and the settings are left as they are: only an
 * explicit Generate may fall back to a clean part.
 */
export async function automaticUpdateBlock(settings: Pick<BandSettings, "bassTone" | "drumTone">, files: PartToneFiles): Promise<string | null> {
  const missing = await missingToneFiles(settings, files);
  return missing.length ? notUpdatedMessage(missing) : null;
}

/** The question an explicit Generate asks before it renders a part clean, for the parts whose tone files are missing. Null when none are. */
export function cleanFallbackQuestion(missing: readonly MissingToneFile[]): string | null {
  const parts = PARTS.filter((part) => missing.some((entry) => entry.part === part)).map((part) => PART_LABEL[part]);
  return parts.length ? `Generate with a clean ${parts.join(" and ")}?` : null;
}

/** The line a preflight shows for a song with a missing tone file. */
export function missingToneWarning(missing: MissingToneFile): string {
  const where = missing.file.source === "tone3000" ? "downloaded from TONE3000" : "at its saved path";
  return `The ${PART_LABEL[missing.part]} tone's ${fileLabel(missing)} (${missing.file.name}) is not on this computer (${where}), so a regenerated ${PART_LABEL[missing.part]} would play clean.`;
}

/** What the mixer row says about a generated part: that its tone is missing when the settings ask for a chain and the audio is clean. */
export function generatedLabel(settings: Pick<BandSettings, "bassTone" | "drumTone" | "renderedTone">, part: TonePart): string {
  const asked = part === "bass" ? settings.bassTone : settings.drumTone;
  return asked.kind === "chain" && settings.renderedTone[part] === "clean" ? "Generated · clean (tone missing)" : "Generated";
}
