let currentFileName = null;
let currentFileHandle = null;
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

function newFile() {
    if (!confirmDiscard()) {
        return;
    }
    editor.innerHTML = "Start writing here...";
    editor.classList.remove('rendered');
    currentFileName = null;
    currentFileHandle = null;
    setDirty(false);
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
    try {
        // Same heuristic as git: a NUL byte in the first 8000 bytes means binary
        const head = new Uint8Array(await file.slice(0, 8000).arrayBuffer());
        if (head.includes(0)) {
            updateStatusBar(`Cannot open ${file.name}: not a text file`);
            return;
        }
        if (!confirmDiscard()) {
            return;
        }
        const text = (await file.text()).replace(/\r\n?/g, '\n');
        renderFileContent(text, file.name);
    } catch (err) {
        updateStatusBar(`Error opening file: ${err.message}`);
        return;
    }

    currentFileName = file.name;
    currentFileHandle = handle;
    setDirty(false);
    updateWordList();
    updateWordCount();
    updateStatusBar(`File opened: ${file.name}`);
}

function renderFileContent(text, fileName) {
    const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    // No <style> (would restyle the whole app) and no ids (could shadow the app's own elements)
    const sanitizeOptions = { FORBID_TAGS: ['style'], FORBID_ATTR: ['id'] };

    // The editor is pre-wrap; markdown/HTML sources expect normal whitespace collapsing between tags
    editor.classList.remove('rendered');
    switch (extension) {
        case 'md':
        case 'markdown':
            editor.innerHTML = DOMPurify.sanitize(marked.parse(text), sanitizeOptions);
            editor.classList.add('rendered');
            break;
        case 'html':
        case 'htm':
            editor.innerHTML = DOMPurify.sanitize(text, sanitizeOptions);
            editor.classList.add('rendered');
            break;
        case 'mlp':
            editor.innerHTML = DOMPurify.sanitize(text, sanitizeOptions);
            break;
        default:
            editor.textContent = text;
    }
}

function confirmDiscard() {
    return !isDirty || confirm('You have unsaved changes. Discard them?');
}

function setDirty(dirty) {
    isDirty = dirty;
    document.title = `${isDirty ? '*' : ''}${currentFileName ? currentFileName + ' – ' : ''}MLP Text Editor`;
}

function saveFile() {
    if (editor.innerHTML === "Start writing here...") {
        updateStatusBar('Nothing to save');
        return;
    }

    updateStatusBar('File saving not available in browser mode');
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
    } else {
        openFile(file);
    }
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