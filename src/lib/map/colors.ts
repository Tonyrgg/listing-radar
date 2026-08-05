const LIGHT_LABEL_TEXT = "#f7faf8";
const DARK_LABEL_TEXT = "#102019";

function relativeLuminance(hexColor: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  if (!match) return 0;
  const channels = match[1].match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function readableTextColor(backgroundColor: string) {
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const lightContrast = 1.05 / (backgroundLuminance + 0.05);
  const darkContrast = (backgroundLuminance + 0.05) / 0.055;
  return darkContrast >= lightContrast ? DARK_LABEL_TEXT : LIGHT_LABEL_TEXT;
}
