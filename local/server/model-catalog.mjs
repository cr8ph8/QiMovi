// Read installed file choices from known ComfyUI loaders. This is discovery,
// not permission to execute a workflow or proof of model quality/capacity.
export function comfyModelFiles(catalogue) {
  const loaders = [
    ['CheckpointLoaderSimple', 'ckpt_name', 'checkpoint'], ['UNETLoader', 'unet_name', 'diffusion'],
    ['VAELoader', 'vae_name', 'VAE'], ['CLIPLoader', 'clip_name', 'text encoder'],
    ['DualCLIPLoader', 'clip_name1', 'text encoder'], ['DualCLIPLoader', 'clip_name2', 'text encoder'],
    ['LoraLoader', 'lora_name', 'LoRA'], ['LoraLoaderModelOnly', 'lora_name', 'LoRA'],
  ];
  const result = new Map();
  for (const [node, field, kind] of loaders) {
    const choices = catalogue?.[node]?.input?.required?.[field]?.[0];
    if (!Array.isArray(choices)) continue;
    for (const name of choices.slice(0, 512)) {
      if (typeof name !== 'string' || !name || name.length > 300 || /[\0\r\n]/.test(name)) continue;
      result.set(`${kind}:${name}`, { kind, name });
      if (result.size >= 512) return [...result.values()];
    }
  }
  return [...result.values()];
}
