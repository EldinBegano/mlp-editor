let currentFileName = null;
let currentFileHandle = null;
// Extension of the document's content (inside an encrypted .mlp: the one stored in it), which decides how Save writes it
let currentExt = 'html';
let isEncrypted = false;
let mlpKey = null;
let isDirty = false;
let words = new Set();
let suggestionBox;
let editor;
let statusBar;
let isDarkMode = true;
let currentTextColor = '#dddddd';

document.addEventListener("DOMContentLoaded", function() {
    suggestionBox = document.getElementById('suggestions');
    editor = document.getElementById('editor');
    statusBar = document.getElementById('status-bar').querySelector('span');
    const colorPreview = document.getElementById('currentColorPreview');
    const colorPicker = document.getElementById('textColorPicker');
    
    colorPreview.style.backgroundColor = currentTextColor;
    colorPicker.value = currentTextColor;
    
    editor.addEventListener("focus", function() {
        if (editor.innerHTML.trim() === "Start writing here...") {
            editor.innerHTML = "";
        }
    });
    
    editor.addEventListener("blur", function() {
        if (editor.innerHTML.trim() === "") {
            editor.innerHTML = "Start writing here...";
        }
    });

    editor.addEventListener('input', function () {
        setDirty(true);
        updateWordList();
        let lastWord = getLastWord();
        showSuggestions(lastWord);
        updateWordCount();
    });
    
    editor.addEventListener('keydown', function (event) {
        let suggestions = document.querySelectorAll('.suggestion');
        let selected = document.querySelector('.suggestion.selected');
    
        if (event.key === 'ArrowDown' && suggestions.length) {
            event.preventDefault();
            if (selected) {
                selected.classList.remove('selected');
                let next = selected.nextElementSibling || suggestions[0];
                next.classList.add('selected');
            } else {
                suggestions[0].classList.add('selected');
            }
        } else if (event.key === 'ArrowUp' && suggestions.length) {
            event.preventDefault();
            if (selected) {
                selected.classList.remove('selected');
                let prev = selected.previousElementSibling || suggestions[suggestions.length - 1];
                prev.classList.add('selected');
            }
        } else if (event.key === 'Enter' && selected) {
            event.preventDefault();
            insertWord(selected.innerText);
        }
    });

    document.addEventListener('dragover', (event) => {
        if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
        }
    });

    document.addEventListener('drop', (event) => {
        if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            handleDrop(event);
        }
    });

    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
            event.preventDefault();
            if (!document.getElementById('appDialog').open) {
                saveFile();
            }
        }
    });

    window.addEventListener('beforeunload', (event) => {
        if (isDirty) {
            event.preventDefault();
            event.returnValue = true;
        }
    });

    document.getElementById('newBtn').addEventListener('click', newFile);
    document.getElementById('openBtn').addEventListener('click', openFileDialog);
    document.getElementById('fileOpen').addEventListener('change', function() {
        if (this.files[0]) {
            openFile(this.files[0]);
        }
        this.value = '';
    });
    document.getElementById('saveBtn').addEventListener('click', saveFile);
    document.getElementById('saveAsBtn').addEventListener('click', () => saveFileAs());
    document.getElementById('encryptBtn').addEventListener('click', encryptFile);
    document.getElementById('imageBtn').addEventListener('click', () => {
        document.getElementById('imageUpload').click();
    });
    document.getElementById('imageUpload').addEventListener('change', insertImage);

    document.getElementById('boldBtn').addEventListener('click', function() {
        this.classList.toggle('active');
        document.execCommand('bold', false, null);
        editor.focus();
    });
    
    document.getElementById('underlineBtn').addEventListener('click', function() {
        this.classList.toggle('active');
        document.execCommand('underline', false, null);
        editor.focus();
    });

    document.getElementById('colorBtn').addEventListener('click', function() {
        colorPicker.click();
    });
    
    colorPicker.addEventListener('input', function(e) {
        currentTextColor = e.target.value;
        colorPreview.style.backgroundColor = currentTextColor;
        document.execCommand('foreColor', false, currentTextColor);
        editor.focus();
    });
    
    colorPicker.addEventListener('change', function(e) {
        currentTextColor = e.target.value;
        colorPreview.style.backgroundColor = currentTextColor;
        updateStatusBar(`Text color changed to ${currentTextColor}`);
    });
    
    document.getElementById('fontSelect').addEventListener('change', function() {
        const selectedFont = this.value;
        document.execCommand('fontName', false, selectedFont);
        editor.focus();
    });
    
    document.getElementById('toggleModeBtn').addEventListener('click', toggleDarkLightMode);

    editor.addEventListener('keydown', function(event) {
        if (event.ctrlKey) {
            switch (event.key.toLowerCase()) {
                case 'b':
                    event.preventDefault();
                    document.execCommand('bold', false, null);
                    document.getElementById('boldBtn').classList.toggle('active');
                    break;
                case 'u':
                    event.preventDefault();
                    document.execCommand('underline', false, null);
                    document.getElementById('underlineBtn').classList.toggle('active');
                    break;
            }
        }
    });

    editor.addEventListener('mouseup', updateFormatButtons);
    editor.addEventListener('keyup', updateFormatButtons);
    
    if (isDarkMode) {
        currentTextColor = '#dddddd';
    } else {
        currentTextColor = '#333333';
    }
    colorPicker.value = currentTextColor;
    colorPreview.style.backgroundColor = currentTextColor;
});

// Decrypted images and PDFs can't be edited, but the browser can show them
const VIEWABLE_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    pdf: 'application/pdf'
};

const SAVE_TYPES = [
    { description: 'HTML document', accept: { 'text/html': ['.html'] } },
    { description: 'Text file', accept: { 'text/plain': ['.txt'] } },
    { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
    { description: 'Encrypted MLP file', accept: { 'application/octet-stream': ['.mlp'] } }
];

const KEYFILE_HINT = 'mlp keeps it at ~/.config/mask-decryption/keyfile on Linux (Ctrl+H in the file dialog shows hidden folders), ' +
    '~/Library/Application Support/mask-decryption/keyfile on macOS and %AppData%\\mask-decryption\\keyfile on Windows. ' +
    'A copy made with "mlp keyfile export" works too. The key is remembered in this browser.';

function newFile() {
    if (!confirmDiscard()) {
        return;
    }
    editor.innerHTML = "Start writing here...";
    editor.classList.remove('rendered');
    setCurrentFile(null, null, 'html', false);
    updateWordCount();
    updateStatusBar('New file created');
}

async function openFileDialog() {
    if (!window.showOpenFilePicker) {
        document.getElementById('fileOpen').click();
        return;
    }

    try {
        const [handle] = await window.showOpenFilePicker();
        await openFile(await handle.getFile(), handle);
    } catch (err) {
        if (err.name !== 'AbortError') {
            updateStatusBar(`Error opening file: ${err.message}`);
        }
    }
}

async function openFile(file, handle = null) {
    let bytes;
    try {
        bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
        updateStatusBar(`Error opening file: ${err.message}`);
        return;
    }

    if (isEncryptedMlp(bytes)) {
        await openEncryptedFile(file.name, bytes, handle);
        return;
    }
    if (isBinary(bytes)) {
        updateStatusBar(`Cannot open ${file.name}: not a text file`);
        return;
    }
    if (!confirmDiscard()) {
        return;
    }

    const ext = fileExtension(file.name);
    renderFileContent(decodeText(bytes), ext);
    if (ext.toLowerCase() === 'mlp') {
        // Old editor files are unencrypted HTML; saving turns them into encrypted .mlp files
        setCurrentFile(file.name, handle, 'html', true);
        updateStatusBar(`Opened ${file.name} (old unencrypted format, saving will encrypt it)`);
    } else {
        setCurrentFile(file.name, handle, ext, false);
        updateStatusBar(`File opened: ${file.name}`);
    }
}

async function openEncryptedFile(fileName, bytes, handle) {
    let result;
    try {
        readMlpHeader(bytes);
        let key = await getKey(`${fileName} is encrypted. Choose your mlp keyfile to open it.`);
        while (!result) {
            if (!key) {
                updateStatusBar('Opening cancelled');
                return;
            }
            try {
                result = await decryptMlp(bytes, key);
            } catch (err) {
                if (!(err instanceof MlpAuthError)) {
                    throw err;
                }
                key = await askForKeyfile(`Could not decrypt ${fileName}: wrong key, or the file is damaged.`);
            }
        }
    } catch (err) {
        updateStatusBar(`Cannot open ${fileName}: ${err.message}`);
        return;
    }

    const type = VIEWABLE_TYPES[result.ext.toLowerCase()];
    if (type) {
        openInNewTab(result.data, type, fileName);
        return;
    }
    if (isBinary(result.data)) {
        updateStatusBar(`${fileName} contains a binary file${result.ext ? ` (.${result.ext})` : ''}, which can't be shown here. Use "mlp decrypt" instead.`);
        return;
    }
    if (!confirmDiscard()) {
        return;
    }

    renderFileContent(decodeText(result.data), result.ext);
    setCurrentFile(fileName, handle, result.ext, true);
    updateStatusBar(`Decrypted ${fileName}`);
}

async function openInNewTab(data, type, fileName) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    let opened = window.open(url, '_blank') !== null;
    if (!opened) {
        // Browsers only allow new tabs right after a click, and that click may be too long ago (or was a drop)
        opened = await showDialog(`${fileName} was decrypted, but the browser blocked opening it in a new tab.`, [
            { label: 'Open in new tab', value: 'open', onClick: () => window.open(url, '_blank') },
            { label: 'Close', value: 'close' }
        ]) === 'open';
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (opened) {
        updateStatusBar(`Opened decrypted ${fileName} in a new tab`);
    }
}

async function getKey(reason) {
    if (!mlpKey) {
        mlpKey = await loadStoredKey().catch(() => null);
    }
    return mlpKey || askForKeyfile(reason);
}

async function askForKeyfile(message) {
    while (true) {
        let picked = Promise.resolve(null);
        const buttons = [{
            label: 'Choose keyfile…',
            value: 'choose',
            onClick: () => {
                picked = chooseFile(document.getElementById('keyfileInput'));
            }
        }];
        if (mlpKey) {
            buttons.push({ label: 'Forget remembered key', value: 'forget' });
        }
        buttons.push({ label: 'Cancel', value: 'cancel' });

        const choice = await showDialog(message, buttons, KEYFILE_HINT);
        if (choice === 'forget') {
            mlpKey = null;
            await forgetStoredKey().catch(() => {});
            message = 'The remembered key was forgotten. Choose a keyfile to continue.';
            continue;
        }
        const file = choice === 'choose' ? await picked : null;
        if (!file) {
            return null;
        }

        try {
            mlpKey = await importKeyfile(file);
        } catch (err) {
            message = err.message;
            continue;
        }
        // Remembering is best effort: IndexedDB can be unavailable, e.g. in private windows
        await storeKey(mlpKey).catch(() => {});
        return mlpKey;
    }
}

function chooseFile(input) {
    return new Promise(resolve => {
        input.onchange = () => {
            resolve(input.files[0] || null);
            input.value = '';
        };
        input.oncancel = () => resolve(null);
        input.click();
    });
}

function showDialog(message, buttons, hint = '') {
    const dialog = document.getElementById('appDialog');
    const paragraphs = [message, hint].filter(Boolean).map((text, i) => {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        paragraph.classList.toggle('hint', i === 1);
        return paragraph;
    });
    document.getElementById('dialogText').replaceChildren(...paragraphs);

    document.getElementById('dialogButtons').replaceChildren(...buttons.map(({ label, value, onClick }, i) => {
        const button = document.createElement('button');
        button.textContent = label;
        button.classList.toggle('primary', i === 0);
        button.addEventListener('click', () => {
            if (onClick) {
                onClick();
            }
            dialog.close(value);
        });
        return button;
    }));

    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(resolve => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue || 'cancel'), { once: true });
    });
}

function renderFileContent(text, ext) {
    // No <style> (would restyle the whole app) and no ids (could shadow the app's own elements)
    const sanitizeOptions = { FORBID_TAGS: ['style'], FORBID_ATTR: ['id'] };

    // The editor is pre-wrap; markdown/HTML sources expect normal whitespace collapsing between tags
    editor.classList.remove('rendered');
    if (ext.toLowerCase() === 'mlp') {
        // Old editor files: HTML the editor wrote itself, in pre-wrap mode
        editor.innerHTML = DOMPurify.sanitize(text, sanitizeOptions);
    } else {
        switch (formatForExt(ext)) {
            case 'markdown':
                editor.innerHTML = DOMPurify.sanitize(marked.parse(text), sanitizeOptions);
                editor.classList.add('rendered');
                break;
            case 'html':
                editor.innerHTML = DOMPurify.sanitize(text, sanitizeOptions);
                editor.classList.add('rendered');
                break;
            default:
                editor.textContent = text;
        }
    }
    updateWordList();
    updateWordCount();
}

function formatForExt(ext) {
    switch (ext.toLowerCase()) {
        case 'md':
        case 'markdown':
            return 'markdown';
        case 'html':
        case 'htm':
            return 'html';
        default:
            return 'text';
    }
}

// Same rule as mlp: a leading dot (.env) is a dotfile, not an extension
function fileExtension(fileName) {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.slice(dot + 1) : '';
}

// Same heuristic as git: a NUL byte in the first 8000 bytes means binary
function isBinary(bytes) {
    return bytes.subarray(0, 8000).includes(0);
}

function decodeText(bytes) {
    return new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n');
}

function confirmDiscard() {
    return !isDirty || confirm('You have unsaved changes. Discard them?');
}

function setDirty(dirty) {
    isDirty = dirty;
    document.title = `${isDirty ? '*' : ''}${currentFileName ? currentFileName + ' – ' : ''}MLP Text Editor`;
}

function setCurrentFile(fileName, handle, ext, encrypted) {
    currentFileName = fileName;
    currentFileHandle = handle;
    currentExt = ext;
    isEncrypted = encrypted;
    document.getElementById('encryptBtn').classList.toggle('active', encrypted);
    setDirty(false);
}

function isEditorEmpty() {
    return editor.innerHTML === "Start writing here...";
}

async function saveFile() {
    if (isEditorEmpty()) {
        updateStatusBar('Nothing to save');
        return;
    }
    if (!currentFileName || (!currentFileHandle && window.showSaveFilePicker)) {
        await saveFileAs();
        return;
    }
    await writeDocument(currentFileName, currentFileHandle, currentExt, isEncrypted);
}

async function saveFileAs(suggestedName = currentFileName || `untitled.${currentExt}`) {
    if (isEditorEmpty()) {
        updateStatusBar('Nothing to save');
        return;
    }

    let fileName;
    let handle = null;
    if (window.showSaveFilePicker) {
        try {
            handle = await window.showSaveFilePicker({ suggestedName, types: SAVE_TYPES });
        } catch (err) {
            if (err.name !== 'AbortError') {
                updateStatusBar(`Error saving file: ${err.message}`);
            }
            return;
        }
        fileName = handle.name;
    } else {
        fileName = prompt('Save as', suggestedName);
        if (!fileName) {
            return;
        }
    }

    // The chosen extension picks the format; a .mlp keeps the current content format inside it
    const encrypted = fileExtension(fileName).toLowerCase() === 'mlp';
    await writeDocument(fileName, handle, encrypted ? currentExt : fileExtension(fileName), encrypted);
}

function encryptFile() {
    if (isEncrypted && currentFileName) {
        return saveFile();
    }
    return saveFileAs(mlpFileName(currentFileName || `untitled.${currentExt}`));
}

// Same naming as "mlp encrypt": notes.txt -> notes.mlp, README -> README.mlp
function mlpFileName(fileName) {
    const ext = fileExtension(fileName);
    return (ext ? fileName.slice(0, -(ext.length + 1)) : fileName) + '.mlp';
}

async function writeDocument(fileName, handle, ext, encrypted) {
    // Asked first, while the click (or Ctrl+S) that started the save still counts as user activation
    if (handle && !(await hasWritePermission(handle))) {
        updateStatusBar(`No permission to write ${fileName}`);
        return;
    }
    const format = formatForExt(ext);
    if (!confirmLossyFormat(format)) {
        return;
    }

    try {
        let bytes = new TextEncoder().encode(serializeEditor(format));
        if (encrypted) {
            const key = await getKey('To save an encrypted .mlp, choose your mlp keyfile. No keyfile yet? Create one with "mlp keygen".');
            if (!key) {
                updateStatusBar('Saving cancelled');
                return;
            }
            bytes = await encryptMlp(bytes, ext, key);
        }

        if (handle) {
            const writable = await handle.createWritable();
            await writable.write(bytes);
            await writable.close();
        } else {
            downloadFile(bytes, fileName);
        }
    } catch (err) {
        updateStatusBar(`Error saving file: ${err.message}`);
        return;
    }

    setCurrentFile(fileName, handle, ext, encrypted);
    updateStatusBar(`Saved ${fileName}${encrypted ? ' (encrypted)' : ''}`);
}

async function hasWritePermission(handle) {
    const options = { mode: 'readwrite' };
    try {
        return (await handle.queryPermission(options)) === 'granted' || (await handle.requestPermission(options)) === 'granted';
    } catch {
        return false;
    }
}

function confirmLossyFormat(format) {
    if (format === 'markdown' && editor.querySelector('font, u, :not(img)[style]')) {
        return confirm("Colors, underline and fonts can't be saved in Markdown and will be lost. Save anyway?");
    }
    if (format === 'text' && editor.querySelector(':not(div, p, br, span), [style]')) {
        return confirm("Formatting and images can't be saved in a text file and will be lost. Save anyway?");
    }
    return true;
}

function serializeEditor(format) {
    if (format === 'text') {
        return editor.innerText;
    }
    if (format === 'markdown') {
        return htmlToMarkdown();
    }
    // Keep the editor's own pre-wrap whitespace when the file is opened in a normal browser
    const body = editor.classList.contains('rendered') ? editor.innerHTML : `<div style="white-space: pre-wrap">${editor.innerHTML}</div>`;
    return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function htmlToMarkdown() {
    const content = editor.cloneNode(true);
    if (!editor.classList.contains('rendered')) {
        // Plain text keeps its line breaks as "\n" (pre-wrap), which turndown would collapse; make them <br>
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }
        textNodes.filter(node => node.data.includes('\n') && !node.parentElement.closest('pre')).forEach(node => {
            node.replaceWith(...node.data.split('\n').flatMap((line, i) => i ? [document.createElement('br'), line] : [line]));
        });
    }

    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    turndown.use(turndownPluginGfm.gfm);
    // turndown's default "-   item" is valid but would rewrite every list; keep the usual "- item" / "1. item"
    turndown.addRule('listItem', {
        filter: 'li',
        replacement: (content, node) => {
            const parent = node.parentNode;
            const start = parent.getAttribute('start');
            const prefix = parent.nodeName === 'OL' ? `${(start ? Number(start) : 1) + [...parent.children].indexOf(node)}. ` : '- ';
            const isParagraph = /\n$/.test(content);
            content = content.replace(/^\n+|\n+$/g, '') + (isParagraph ? '\n' : '');
            return prefix + content.replace(/\n/g, '\n' + ' '.repeat(prefix.length)) + (node.nextSibling ? '\n' : '');
        }
    });
    return turndown.turndown(content) + '\n';
}

function downloadFile(bytes, fileName) {
    const url = URL.createObjectURL(new Blob([bytes]));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function insertImage(event) {
    const file = event.target.files[0];
    if (file) {
        insertImageFile(file);
        document.getElementById('imageUpload').value = '';
    }
}

function insertImageFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.style.maxWidth = '100%';

        const selection = window.getSelection();
        if (selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(img);

            range.setStartAfter(img);
            range.setEndAfter(img);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            editor.appendChild(img);
        }

        setDirty(true);
        updateStatusBar('Image inserted');
    };
    reader.readAsDataURL(file);
}

function handleDrop(event) {
    const file = event.dataTransfer.files[0];
    if (!file) {
        return;
    }

    if (file.type.startsWith('image/')) {
        insertImageFile(file);
        return;
    }
    // Only available during the event; it lets Save write back to the dropped file (Chromium)
    const item = event.dataTransfer.items[0];
    const handlePromise = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : Promise.resolve(null);
    handlePromise.catch(() => null).then(handle => openFile(file, handle && handle.kind === 'file' ? handle : null));
}

function updateWordList() {
    let text = editor.innerText;
    let wordsArray = text.match(/\b\w{2,}\b/g) || [];

    wordsArray.forEach(word => words.add(word.toLowerCase()));
}

function getLastWord() {
    let text = editor.innerText;
    let wordsArray = text.split(/\s+/);
    return wordsArray[wordsArray.length - 1] || '';
}

function showSuggestions(givenChars) {
    if (!givenChars || givenChars.length < 3) {
        suggestionBox.style.display = 'none';
        return;
    }

    let matches = [...words].filter(word => word.startsWith(givenChars.toLowerCase()));

    if (matches.length === 0) {
        suggestionBox.style.display = 'none';
        return;
    }

    suggestionBox.innerHTML = matches.map(word => `<div class="suggestion">${word}</div>`).join('');
    
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        const editorRect = editor.getBoundingClientRect();
        
        let top = rect.bottom - editorRect.top + editor.scrollTop;
        let left = rect.left - editorRect.left;
        
        const maxLeft = editorRect.width - 150; 
        if (left > maxLeft) left = maxLeft;
        
        suggestionBox.style.position = 'absolute';
        suggestionBox.style.top = `${top}px`;
        suggestionBox.style.left = `${left}px`;
        suggestionBox.style.display = 'block';
        
        const suggestionBoxRect = suggestionBox.getBoundingClientRect();
        if (suggestionBoxRect.bottom > window.innerHeight) {
            suggestionBox.style.top = `${rect.top - editorRect.top - suggestionBoxRect.height + editor.scrollTop}px`;
        }
    }

    document.querySelectorAll('.suggestion').forEach(item => {
        item.addEventListener('click', () => insertWord(item.innerText));
    });
}

function insertWord(word) {
    let text = editor.innerText;
    let wordsArray = text.split(/\s+/);
    wordsArray[wordsArray.length - 1] = word;
    editor.innerText = wordsArray.join(' ') + ' ';
    suggestionBox.style.display = 'none';
    editor.focus();
}

function updateStatusBar(message) {
    statusBar.textContent = message;
    setTimeout(() => {
        statusBar.textContent = currentFileName ? `Editing: ${currentFileName}` : 'Ready';
    }, 3000);
}

function toggleDarkLightMode() {
    const body = document.body;
    const toggleBtn = document.getElementById('toggleModeBtn');
    const colorPicker = document.getElementById('textColorPicker');
    const colorPreview = document.getElementById('currentColorPreview');
    
    body.classList.toggle('light-mode');
    isDarkMode = !body.classList.contains('light-mode');
    
    if (isDarkMode) {
        currentTextColor = '#dddddd';
    } else {
        currentTextColor = '#333333';
    }
    
    colorPicker.value = currentTextColor;
    colorPreview.style.backgroundColor = currentTextColor;
    
    if (isDarkMode) {
        toggleBtn.innerHTML = '<i class="fa fa-sun-o"></i> Light Mode';
    } else {
        toggleBtn.innerHTML = '<i class="fa fa-moon-o"></i> Dark Mode';
    }
    
    updateStatusBar(`Switched to ${isDarkMode ? 'dark' : 'light'} mode`);
}

function updateFormatButtons() {
    const isBold = document.queryCommandState('bold');
    const isUnderlined = document.queryCommandState('underline');
    
    document.getElementById('boldBtn').classList.toggle('active', isBold);
    document.getElementById('underlineBtn').classList.toggle('active', isUnderlined);
    
    const currentColor = document.queryCommandValue('foreColor');
    if (currentColor && currentColor !== '') {
        document.getElementById('currentColorPreview').style.backgroundColor = currentColor;
        currentTextColor = currentColor;
        document.getElementById('textColorPicker').value = rgbToHex(currentColor);
    }
    
    const currentFont = document.queryCommandValue('fontName');
    const fontSelect = document.getElementById('fontSelect');
    
    for (let i = 0; i < fontSelect.options.length; i++) {
        if (currentFont.includes(fontSelect.options[i].value.split(',')[0].replace(/['"]/g, ''))) {
            fontSelect.selectedIndex = i;
            break;
        }
    }
}

function rgbToHex(rgb) {
    if (rgb.startsWith('#')) {
        return rgb;
    }
    
    let rgbValues = rgb.match(/\d+/g);
    
    if (!rgbValues || rgbValues.length !== 3) {
        return '#dddddd';
    }
    
    let hex = '#';
    for (let i = 0; i < 3; i++) {
        let hexComponent = parseInt(rgbValues[i]).toString(16);
        hex += hexComponent.length === 1 ? '0' + hexComponent : hexComponent;
    }
    
    return hex;
}

function updateWordCount() {
    let text = editor.innerText.trim();
    let wordCount = text.length === 0 || text === "Start writing here..." ? 0 : text.split(/\s+/).length;
    document.getElementById('wordCount').textContent = `Words: ${wordCount}`;
}