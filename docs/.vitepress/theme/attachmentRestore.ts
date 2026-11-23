import type { NoteAttachment } from './attachmentStore'

/** The collection snapshot must only be published after every image is on
 * disk and the remote/local state is still the one used to read it. */
export async function finishAttachmentRestore(
  images: NoteAttachment[], head: string,
  operations: { put: (image: NoteAttachment) => Promise<void>; readHead: () => Promise<string>; isCurrent: () => boolean }
): Promise<void> {
  const checkLocal = () => { if (!operations.isCurrent()) throw new Error('恢复期间本机目录发生变化，请重新恢复。') }
  checkLocal()
  for (const image of images) { await operations.put(image); checkLocal() }
  if (await operations.readHead() !== head) throw new Error('恢复期间 GitHub 内容发生变化，请重新恢复。')
  checkLocal()
}
