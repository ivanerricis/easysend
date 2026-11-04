# Sending files

Open **Send files** (the home page after you sign in), choose what to send, set the options and click **Create link** (or **Send** for the email mode). The files are uploaded in chunks, can be resumed after an interruption or a page reload, and are encrypted on the server. When the upload ends you get the link to share.

## Folders

You can send whole folders, not only single files.

- **Drag and drop.** Drop one or more folders (and files, together) on the upload area. Subfolders are included.
- **Choose a folder.** Click **Choose folder** and pick the folder in the system dialog. The browser asks you to confirm that it may read the files, which only means the files are uploaded.
- **The structure is kept.** A folder such as `project/img/logo.png` stays `project/img/logo.png`: the selection groups the files by folder, and you can remove a whole folder with one click or a single file inside it.
- **Recipients see a tree.** The download page and the transfer detail show the folders, which you can open and close, with the number of files and the size of each. Each file has its own download button; a single file downloads under its own name (`logo.png`, not the path).
- **The zip recreates the folders.** **Download all as ZIP** (and the zip of a selection) contains the same folders and subfolders, so extracting it gives back the structure you sent.
- **System files are skipped.** `.DS_Store`, `Thumbs.db` and `desktop.ini` are not uploaded.
- **Names are cleaned.** Folder and file names are cleaned on the server like file names always were (no path traversal, no control characters). If two entries would end up with the same path in the zip, the second gets a number: `report (1).pdf`.
- **Limits.** A folder counts every file it contains against the limit of files per transfer. The default is **1000 files**; an admin can change it from 1 to 5000 in **Settings → General → Max files per transfer**. A folder up to 32 levels deep and 1024 characters of path is accepted. Files beyond the limit are not added and the form tells you how many were left out. Empty folders are not sent.

The same folder picker is available on the upload page of a file request ([Receiving files](./receiving-files)); received folders appear as a tree in the transfer.
