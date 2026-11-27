import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notifyError } from "./notify";
import { useDevice } from "@/state/device";
import { useScenes } from "@/state/scenes";

/**
 * Next to the preset switcher on a pedal running the GrooveGurus mod: edit the preset, or its scenes (the footswitches
 * under the Rig header select them). Follows the pedal when scene mode is switched there.
 */
export function EditModeSelect() {
  const available = useDevice((s) => s.status === "connected" && s.features.includes("modScenes"));
  const busy = useDevice((s) => s.busy !== null);
  const mode = useScenes((s) => s.mode);
  const writing = useScenes((s) => s.writing);
  if (!available) return null;

  const change = async (next: string) => {
    try {
      await useScenes.getState().setMode(next === "scene" ? "scene" : "preset");
    } catch (e) {
      notifyError("Couldn't go back to the base", e);
    }
  };

  return (
    <Select value={mode} onValueChange={(v) => void change(v)} disabled={busy || writing}>
      <SelectTrigger
        size="sm"
        aria-label="Edit mode"
        className="no-drag glass-float w-[132px] bg-transparent font-medium text-silkscreen shadow-[var(--glass-shine),0_0_0_1px_var(--glass-edge),0_4px_16px_rgb(0_0_0/0.3)] hover:bg-white/6 dark:bg-transparent dark:hover:bg-white/6"
      >
        <span className="text-silkscreen-3">Edit</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={8}>
        <SelectItem value="preset">Preset</SelectItem>
        <SelectItem value="scene">Scenes</SelectItem>
      </SelectContent>
    </Select>
  );
}
