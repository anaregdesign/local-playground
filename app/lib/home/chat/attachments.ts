export type ChatAttachment = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
};

export type DraftChatAttachment = ChatAttachment & {
  id: string;
};

export async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string" && reader.result.trim()) {
        resolve(reader.result);
        return;
      }

      reject(new Error("File data is empty."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read file."));
    });
    reader.readAsDataURL(file);
  });
}

export function formatChatAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kb = sizeBytes / 1024;
  if (kb < 1024) {
    return `${trimSizeFraction(kb)} KB`;
  }

  const mb = kb / 1024;
  if (mb < 1024) {
    return `${trimSizeFraction(mb)} MB`;
  }

  const gb = mb / 1024;
  return `${trimSizeFraction(gb)} GB`;
}

function trimSizeFraction(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}
