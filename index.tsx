// index.tsx
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Extend the global Window interface to include jsPDF and SpeechRecognition
declare global {
    interface Window {
        jspdf: any; // For jsPDF library
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

interface CheckboxOption {
    value: string;
    text: string;
}

interface FormField {
    label: string;
    id: string;
    type: 'text' | 'number' | 'select' | 'checkbox-group' | 'radio-group' | 'textarea' | 'file' | 'date' | 'clearance-group';
    placeholder?: string;
    options?: { value: string; text: string }[];
    checkboxOptions?: CheckboxOption[]; // Used for checkbox-group and radio-group
    required?: boolean;
    defaultValue?: string;
    multiple?: boolean; // For file input
    accept?: string;    // For file input MIME types
    assessmentOptions?: string[]; // For radio buttons next to an input
    defaultAssessmentOption?: string; // Default checked radio button
    containerId?: string; // Optional ID for the field's container div
}

interface FileWithComment {
    name: string;
    comment: string;
    dataUrl: string; // Base64 encoded data URL
    type: string;    // MIME type
}

interface FormSectionData {
    title: string;
    id: string;
    fields: FormField[];
}

// List of field IDs that should have voice-to-text enabled
const voiceEnabledFieldIds = [
    'crossing-description', 'weather-conditions', 'vegetation-growth', 'scour-erosion',
    'proximity-water', 'debris-accumulation', 'other-support-specify',
    'support-condition-thermal-stress-comments', 'pipe-movement-at-supports-comments',
    'sliding-roller-functionality-comments', 'support-comments', 'other-expansion-specify',
    'expansion-feature-functionality-comments', 'expansion-comments', 'other-coating-type-specify',
    'coating-comments', 'cp-comments', 'pipe-physical-damage', 'atmospheric-corrosion-details',
    'clearance-comments', 'safety-hazards', 'access-structures-condition',
    'access-safety-comments', 'photographs-taken', 'other-utilities-bridge',
    'bridge-structure-condition', 'third-party-damage-potential', 'third-party-comments',
    'immediate-hazards', 'actions-taken-hazards', 'recommendations-summary',
    'final-summary-evaluation', 'modal-exec-summary', 'modal-final-summary',
    'wall-thickness-comments' // Added new comment field
];


// --- Central data store for all file inputs ---
const fileDataStore: { [inputId: string]: FileWithComment[] } = {};

// --- API Key Management ---
function getApiKey(): string | null {
    const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
    if (apiKeyInput && apiKeyInput.value.trim()) {
        return apiKeyInput.value.trim();
    }
    return null;
}

function saveApiKey(key: string) {
    localStorage.setItem('userApiKey', key);
}

function loadApiKey() {
    return localStorage.getItem('userApiKey');
}


// --- Helper to read a file as a Base64 Data URL ---
const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

// --- Helper to render the file list for a given input ---
function renderFileList(inputId: string) {
    const container = document.getElementById(`${inputId}-list-container`);
    if (!container) return;
    
    container.innerHTML = '';
    const files = fileDataStore[inputId];

    if (files && files.length > 0) {
        const list = document.createElement('ul');
        list.classList.add('file-comment-list');

        files.forEach((fileInfo, index) => {
            const listItem = document.createElement('li');
            listItem.classList.add('file-comment-item');

            const filePreviewContainer = document.createElement('div');
            filePreviewContainer.classList.add('file-preview-container');

            // Updated logic to handle renderable vs non-renderable images
            if (fileInfo.type.startsWith('image/') && fileInfo.type !== 'image/tiff') {
                const img = document.createElement('img');
                img.src = fileInfo.dataUrl;
                img.classList.add('file-thumbnail');
                img.alt = `Thumbnail for ${fileInfo.name}`;
                filePreviewContainer.appendChild(img);
            } else if (fileInfo.type.startsWith('image/')) { // Handles TIFF and other image types
                filePreviewContainer.classList.add('placeholder');
                filePreviewContainer.innerHTML = '<span>🖼️</span>'; // Picture/frame emoji
                filePreviewContainer.title = 'Image file (preview not supported for this format)';
            } else { // Handles non-image files
                filePreviewContainer.classList.add('placeholder');
                filePreviewContainer.innerHTML = '<span>📄</span>'; // Document emoji
                filePreviewContainer.title = `Document file: ${fileInfo.type}`;
            }

            const fileInfoContainer = document.createElement('div');
            fileInfoContainer.classList.add('file-info-container');
            
            const fileNameEl = document.createElement('div');
            fileNameEl.classList.add('file-name');
            fileNameEl.textContent = fileInfo.name;
            
            const commentInput = document.createElement('input');
            commentInput.type = 'text';
            commentInput.classList.add('file-comment-input');
            commentInput.placeholder = 'Add a comment...';
            commentInput.setAttribute('data-file-name', fileInfo.name);
            commentInput.value = fileInfo.comment;
            commentInput.addEventListener('change', (e) => {
                const newComment = (e.target as HTMLInputElement).value;
                if (fileDataStore[inputId] && fileDataStore[inputId][index]) {
                    fileDataStore[inputId][index].comment = newComment;
                }
            });

            fileInfoContainer.appendChild(fileNameEl);
            fileInfoContainer.appendChild(commentInput);
            listItem.appendChild(filePreviewContainer);
            listItem.appendChild(fileInfoContainer);
            list.appendChild(listItem);
        });
        container.appendChild(list);
    } else {
        container.innerHTML = `<p class="no-files-message">No files selected.</p>`;
    }
}

// --- Helper to auto-resize textareas ---
function autoResizeTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = 'auto'; // Reset height to recalculate
    textarea.style.height = `${textarea.scrollHeight}px`;
}

// --- Helper to add text improvement button ---
function addImproveButton(wrapper: HTMLElement, inputElement: HTMLTextAreaElement) {
    const improveButton = document.createElement('button');
    improveButton.type = 'button';
    improveButton.classList.add('improve-button');
    improveButton.textContent = 'Improve';
    improveButton.setAttribute('aria-label', `Improve text for ${inputElement.id}`);

    improveButton.addEventListener('click', async () => {
        const apiKey = getApiKey();
        if (!apiKey) {
            alert("Please enter your Google AI API Key to use this feature.");
            document.getElementById('api-key-input')?.focus();
            return;
        }

        const originalText = inputElement.value.trim();
        if (!originalText) {
            alert("There is no text to improve.");
            return;
        }

        improveButton.disabled = true;
        improveButton.textContent = 'Working...';
        
        const oldSuggestions = wrapper.querySelector('.suggestions-container');
        if (oldSuggestions) {
            oldSuggestions.remove();
        }
        
        try {
            const ai = new GoogleGenAI({apiKey: apiKey});
            const prompt = `Rewrite the following text for a professional engineering field report. Provide 3 distinct alternative versions in a JSON array format, like ["suggestion 1", "suggestion 2", "suggestion 3"]. Improve clarity, grammar, and sentence structure, but preserve all original facts and the core meaning. Do not add any new information. Original text: "${originalText}"`;
            
            const response: GenerateContentResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-04-17',
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            
            let suggestions: string[] = [];
            let jsonStr = response.text.trim();
            const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
            const match = jsonStr.match(fenceRegex);
            if (match && match[2]) {
              jsonStr = match[2].trim();
            }
            
            try {
                const parsedData = JSON.parse(jsonStr);
                if (Array.isArray(parsedData) && parsedData.every(item => typeof item === 'string')) {
                    suggestions = parsedData;
                } else {
                    suggestions = [response.text];
                }
            } catch (e) {
                suggestions = [response.text]; 
            }

            if (suggestions.length === 0) {
                alert("Could not generate improvement suggestions.");
                return;
            }

            const suggestionsContainer = document.createElement('div');
            suggestionsContainer.className = 'suggestions-container';

            const header = document.createElement('div');
            header.className = 'suggestions-header';
            const title = document.createElement('span');
            title.textContent = 'Suggestions';
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '&times;';
            closeBtn.className = 'suggestions-close-btn';
            closeBtn.setAttribute('aria-label', 'Close suggestions');
            closeBtn.onclick = () => suggestionsContainer.remove();
            header.appendChild(title);
            header.appendChild(closeBtn);
            suggestionsContainer.appendChild(header);

            suggestions.forEach(suggestionText => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = suggestionText;
                item.tabIndex = 0;
                const selectSuggestion = () => {
                    inputElement.value = suggestionText;
                    autoResizeTextarea(inputElement);
                    suggestionsContainer.remove();
                };
                item.onclick = selectSuggestion;
                item.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        selectSuggestion();
                    }
                };
                suggestionsContainer.appendChild(item);
            });

            wrapper.appendChild(suggestionsContainer);

        } catch (error) {
            console.error("Error improving text:", error);
            alert("Could not retrieve suggestions. Please check the console for more details.");
        } finally {
            improveButton.disabled = false;
            improveButton.textContent = 'Improve';
        }
    });

    wrapper.appendChild(improveButton);
}

// --- Helper to add voice-to-text microphone button ---
function addMicrophoneButton(wrapper: HTMLElement, inputElement: HTMLTextAreaElement) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const micButton = document.createElement('button');
    micButton.type = 'button';
    micButton.classList.add('mic-button');
    micButton.innerHTML = '&#127908;';
    micButton.setAttribute('aria-label', `Start voice input for ${inputElement.id}`);

    micButton.addEventListener('click', () => {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        micButton.classList.add('listening');

        recognition.onend = () => micButton.classList.remove('listening');
        recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            micButton.classList.remove('listening');
        };
        
        let finalTranscript = inputElement.value ? inputElement.value.trim() + ' ' : '';

        recognition.onresult = (event: any) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript.trim() + '. ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            inputElement.value = finalTranscript + interimTranscript;
            autoResizeTextarea(inputElement);
        };

        recognition.start();
    });

    wrapper.appendChild(micButton);
}

function createFieldElement(field: FormField): HTMLElement {
    const fieldContainer = document.createElement('div');
    fieldContainer.classList.add('form-field');
    if (field.containerId) {
        fieldContainer.id = field.containerId;
    }

    const labelElement = document.createElement('label');
    labelElement.htmlFor = field.id;
    labelElement.textContent = field.label;
    if (field.type !== 'checkbox-group' && field.type !== 'radio-group' && field.type !== 'clearance-group') {
        fieldContainer.appendChild(labelElement);
    }
    
    let inputWrapper: HTMLElement;
    if (field.type === 'textarea' || voiceEnabledFieldIds.includes(field.id)) {
        inputWrapper = document.createElement('div');
        inputWrapper.classList.add('input-with-mic-wrapper');
        fieldContainer.appendChild(inputWrapper);
    } else {
        inputWrapper = fieldContainer;
    }
    
    if (field.type === 'select') {
        const select = document.createElement('select');
        select.id = field.id;
        select.name = field.id;
        if (field.required) select.required = true;

        if (field.options) {
            field.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                if (opt.value === '' && !field.defaultValue) {
                    option.disabled = true;
                    option.selected = true; 
                }
                select.appendChild(option);
            });
        }
        if (field.defaultValue) {
            select.value = field.defaultValue;
        }
        inputWrapper.appendChild(select);

    } else if (field.type === 'checkbox-group' || field.type === 'radio-group') {
        const fieldset = document.createElement('fieldset');
        fieldset.classList.add(`${field.type}-fieldset`);

        const legend = document.createElement('legend');
        legend.textContent = field.label;
        fieldset.appendChild(legend);

        if (field.checkboxOptions) {
            field.checkboxOptions.forEach(opt => {
                const itemContainer = document.createElement('div');
                itemContainer.classList.add(`${field.type === 'radio-group' ? 'radio' : 'checkbox'}-item`);

                const input = document.createElement('input');
                input.type = field.type === 'radio-group' ? 'radio' : 'checkbox';
                input.id = `${field.id}-${opt.value.toLowerCase().replace(/\s+/g, '-')}`;
                input.name = field.id;
                input.value = opt.value;

                const itemLabel = document.createElement('label');
                itemLabel.htmlFor = input.id;
                itemLabel.textContent = opt.text;

                itemContainer.appendChild(input);
                itemContainer.appendChild(itemLabel);

                // --- Special handling for quantity input ---
                if (field.id === 'expansion-feature') {
                    const quantityInput = document.createElement('input');
                    quantityInput.type = 'number';
                    quantityInput.min = '1';
                    quantityInput.step = '1';
                    quantityInput.placeholder = 'Qty';
                    quantityInput.className = 'quantity-input';
                    quantityInput.id = `${input.id}-quantity`;
                    quantityInput.style.display = 'none'; // Initially hidden

                    input.addEventListener('change', () => {
                        if (input.checked) {
                            quantityInput.style.display = 'inline-block';
                            if (!quantityInput.value) {
                               quantityInput.value = '1'; // Default to 1 only if empty
                            }
                        } else {
                            quantityInput.style.display = 'none';
                            quantityInput.value = ''; // Clear value when unchecked
                        }
                    });
                    itemContainer.appendChild(quantityInput);
                }
                // --- End special handling ---

                fieldset.appendChild(itemContainer);
            });
        }
        inputWrapper.appendChild(fieldset);

    } else if (field.type === 'clearance-group') {
        const fieldset = document.createElement('fieldset');
        fieldset.classList.add('clearance-group-fieldset');
        
        const legend = document.createElement('legend');
        legend.textContent = field.label;
        fieldset.appendChild(legend);

        if (field.options) {
            field.options.forEach(opt => {
                const itemContainer = document.createElement('div');
                itemContainer.classList.add('clearance-item');
                
                const itemLabel = document.createElement('label');
                itemLabel.textContent = opt.text;
                itemLabel.htmlFor = `${field.id}-${opt.value}-value`;

                const inputGroup = document.createElement('div');
                inputGroup.classList.add('clearance-input-group');

                const valueInput = document.createElement('input');
                valueInput.type = 'number';
                valueInput.id = `${field.id}-${opt.value}-value`;
                valueInput.name = `${field.id}-${opt.value}-value`;
                valueInput.placeholder = 'Distance';

                const unitSelect = document.createElement('select');
                unitSelect.id = `${field.id}-${opt.value}-units`;
                unitSelect.name = `${field.id}-${opt.value}-units`;

                const ftOption = document.createElement('option');
                ftOption.value = 'ft';
                ftOption.textContent = 'ft';
                unitSelect.appendChild(ftOption);

                const inOption = document.createElement('option');
                inOption.value = 'in';
                inOption.textContent = 'in';
                unitSelect.appendChild(inOption);
                
                inputGroup.appendChild(valueInput);
                inputGroup.appendChild(unitSelect);

                itemContainer.appendChild(itemLabel);
                itemContainer.appendChild(inputGroup);
                fieldset.appendChild(itemContainer);
            });
        }
        fieldContainer.appendChild(fieldset);
    } else if (field.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.id = field.id;
        textarea.name = field.id;
        if (field.placeholder) textarea.placeholder = field.placeholder;
        if (field.defaultValue) textarea.value = field.defaultValue;
        textarea.addEventListener('input', () => autoResizeTextarea(textarea));
        inputWrapper.appendChild(textarea);
        if (voiceEnabledFieldIds.includes(field.id)) {
            addMicrophoneButton(inputWrapper as HTMLElement, textarea);
            addImproveButton(inputWrapper as HTMLElement, textarea);
        }

    } else if (field.type === 'file') {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = field.id;
        fileInput.name = field.id;
        if (field.multiple) fileInput.multiple = true;
        if (field.accept) fileInput.accept = field.accept;
        
        fileInput.addEventListener('change', async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (files) {
                fileDataStore[field.id] = fileDataStore[field.id] || [];
                for (const file of Array.from(files)) {
                  try {
                    const dataUrl = await readFileAsDataURL(file);
                    fileDataStore[field.id].push({ name: file.name, comment: '', dataUrl, type: file.type });
                  } catch (error) {
                    console.error("Error reading file:", file.name, error);
                    alert(`Could not read file: ${file.name}`);
                  }
                }
                renderFileList(field.id);
            }
        });
        inputWrapper.appendChild(fileInput);
        
        const listContainer = document.createElement('div');
        listContainer.id = `${field.id}-list-container`;
        listContainer.classList.add('file-list-container');
        fieldContainer.appendChild(listContainer);

    } else if (field.type === 'date' || field.type === 'text' || field.type === 'number') {
        const input = document.createElement('input');
        input.type = field.type;
        input.id = field.id;
        input.name = field.id;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.defaultValue) input.value = field.defaultValue;
        inputWrapper.appendChild(input);
        
        if (field.assessmentOptions) {
            const assessmentGroup = document.createElement('div');
            assessmentGroup.classList.add('assessment-options-group');
            field.assessmentOptions.forEach((optionText, index) => {
                const radioItem = document.createElement('div');
                radioItem.classList.add('radio-item-inline');
                const radioInput = document.createElement('input');
                radioInput.type = 'radio';
                const radioId = `${field.id}-assessment-${index}`;
                radioInput.id = radioId;
                radioInput.name = `${field.id}-assessment`;
                radioInput.value = optionText;
                
                if (field.defaultAssessmentOption === optionText) {
                    radioInput.checked = true;
                }
                
                const radioLabel = document.createElement('label');
                radioLabel.htmlFor = radioId;
                radioLabel.textContent = optionText;

                radioItem.appendChild(radioInput);
                radioItem.appendChild(radioLabel);
                assessmentGroup.appendChild(radioItem);
            });
            fieldContainer.appendChild(assessmentGroup);
        }
    }

    return fieldContainer;
}

// Data definitions for conditional selects
const systemData = {
    'bng': [
        { value: '', text: 'Select BNG System...' },
        { value: 'Bangor Steel|500 PSIG', text: 'Bangor Steel (MAOP: 500 PSIG)' },
        { value: 'Lincoln|60 PSIG', text: 'Lincoln (MAOP: 60 PSIG)' },
        { value: 'Bangor IP|60 PSIG', text: 'Bangor IP (MAOP: 60 PSIG)' },
        { value: 'Brewer|60 PSIG', text: 'Brewer (MAOP: 60 PSIG)' },
        { value: 'Searsport|60 PSIG', text: 'Searsport (MAOP: 60 PSIG)' },
        { value: 'Orrington|720 PSIG', text: 'Orrington (MAOP: 720 PSIG)' },
        { value: 'Bucksport|60 PSIG', text: 'Bucksport (MAOP: 60 PSIG)' }
    ],
    'nu-me': [
        { value: '', text: 'Select NU-ME System...' },
        { value: '380 Riverside|56 PSIG', text: '380 Riverside (MAOP: 56 PSIG)' },
        { value: '470 Riverside|56 PSIG', text: '470 Riverside (MAOP: 56 PSIG)' },
        { value: 'Biddeford Industrial Park|40 PSIG', text: 'Biddeford Industrial Park (MAOP: 40 PSIG)' },
        { value: 'Blueberry Road|60 PSIG', text: 'Blueberry Road (MAOP: 60 PSIG)' },
        { value: 'Bolt Hill Road|99 PSIG', text: 'Bolt Hill Road (MAOP: 99 PSIG)' },
        { value: 'Cascade Road|56 PSIG', text: 'Cascade Road (MAOP: 56 PSIG)' },
        { value: 'Congress St 125 System|125 PSIG', text: 'Congress St 125 System (MAOP: 125 PSIG)' },
        { value: 'Darling Avenue|99 PSIG', text: 'Darling Avenue (MAOP: 99 PSIG)' },
        { value: 'Debbie Lane|500 PSIG', text: 'Debbie Lane (MAOP: 500 PSIG)' },
        { value: 'Dennet St|99 PSIG', text: 'Dennet St (MAOP: 99 PSIG)' },
        { value: 'Goddard Road|56 PSIG', text: 'Goddard Road (MAOP: 56 PSIG)' },
        { value: 'Hussey Seating|25 PSIG', text: 'Hussey Seating (MAOP: 25 PSIG)' },
        { value: 'Larrabee Road|30 PSIG', text: 'Larrabee Road (MAOP: 30 PSIG)' },
        { value: 'Larrabee Road|56 PSIG', text: 'Larrabee Road (MAOP: 56 PSIG)' },
        { value: 'Levesque Drive|99 PSIG', text: 'Levesque Drive (MAOP: 99 PSIG)' },
        { value: 'Lewiston High Line|250 PSIG', text: 'Lewiston High Line (MAOP: 250 PSIG)' },
        { value: 'Lewiston-Auburn IP|56 PSIG', text: 'Lewiston-Auburn IP (MAOP: 56 PSIG)' },
        { value: 'Lisbon 99|99 PSIG', text: 'Lisbon 99 (MAOP: 99 PSIG)' },
        { value: 'Marshwood High School|56 PSIG', text: 'Marshwood High School (MAOP: 56 PSIG)' },
        { value: 'Northeast Millworks|56 PSIG', text: 'Northeast Millworks (MAOP: 56 PSIG)' },
        { value: 'PNSY|30 PSIG', text: 'PNSY (MAOP: 30 PSIG)' },
        { value: 'Payne Road|200 PSIG', text: 'Payne Road (MAOP: 200 PSIG)' },
        { value: 'Pineland|99 PSIG', text: 'Pineland (MAOP: 99 PSIG)' },
        { value: 'Poland Road HP|99 PSIG', text: 'Poland Road HP (MAOP: 99 PSIG)' },
        { value: 'Poland Road IP|80 PSIG', text: 'Poland Road IP (MAOP: 80 PSIG)' },
        { value: 'Pratt & Whitney|99 PSIG', text: 'Pratt & Whitney (MAOP: 99 PSIG)' },
        { value: 'Railroad Avenue|56 PSIG', text: 'Railroad Avenue (MAOP: 56 PSIG)' },
        { value: 'Regan Lane|30 PSIG', text: 'Regan Lane (MAOP: 30 PSIG)' },
        { value: 'River Road IP|56 PSIG', text: 'River Road IP (MAOP: 56 PSIG)' },
        { value: 'Riverside @ Waldron|56 PSIG', text: 'Riverside @ Waldron (MAOP: 56 PSIG)' },
        { value: 'Route 109|56 PSIG', text: 'Route 109 (MAOP: 56 PSIG)' },
        { value: 'Roundwood|30 PSIG', text: 'Roundwood (MAOP: 30 PSIG)' },
        { value: 'Saco Brick|56 PSIG', text: 'Saco Brick (MAOP: 56 PSIG)' },
        { value: 'Sanborn Lane|99 PSIG', text: 'Sanborn Lane (MAOP: 99 PSIG)' },
        { value: 'Sandford West|99 PSIG', text: 'Sandford West (MAOP: 99 PSIG)' },
        { value: 'Scarborough Industrial Park|56 PSIG', text: 'Scarborough Industrial Park (MAOP: 56 PSIG)' },
        { value: 'Shapleigh Lane|56 PSIG', text: 'Shapleigh Lane (MAOP: 56 PSIG)' },
        { value: "Shephard's Cove|99 PSIG", text: "Shephard's Cove (MAOP: 99 PSIG)" },
        { value: 'South Portland|30 PSIG', text: 'South Portland (MAOP: 30 PSIG)' },
        { value: "Thompson's Point|99 PSIG", text: "Thompson's Point (MAOP: 99 PSIG)" },
        { value: 'Twine Mill|99 PSIG', text: 'Twine Mill (MAOP: 99 PSIG)' },
        { value: 'Waldo Street|30 PSIG', text: 'Waldo Street (MAOP: 30 PSIG)' },
        { value: 'Westgate|56 PSIG', text: 'Westgate (MAOP: 56 PSIG)' },
        { value: 'Wilson Road|99 PSIG', text: 'Wilson Road (MAOP: 99 PSIG)' }
    ],
    'nu-nh': [
        { value: '', text: 'Select NU-NH System...' },
        { value: 'Dover LP|13.8 Inches W.C.', text: 'Dover LP (MAOP: 13.8 Inches W.C.)' },
        { value: 'Dover-Somersworth|397 PSIG', text: 'Dover-Somersworth (MAOP: 397 PSIG)' },
        { value: 'Dover IP|55 PSIG', text: 'Dover IP (MAOP: 55 PSIG)' },
        { value: 'UNH, Dover|99 PSIG', text: 'UNH, Dover (MAOP: 99 PSIG)' },
        { value: 'Dover Industrial Pk (Crosby)|55 PSIG', text: 'Dover Industrial Pk (Crosby) (MAOP: 55 PSIG)' },
        { value: 'Locust / Cataract, Dover|55 PSIG', text: 'Locust / Cataract, Dover (MAOP: 55 PSIG)' },
        { value: 'Dover Pt Road|56 PSIG', text: 'Dover Pt Road (MAOP: 56 PSIG)' },
        { value: 'College Road|56 PSIG', text: 'College Road (MAOP: 56 PSIG)' },
        { value: 'Mill Road, Durham|56 PSIG', text: 'Mill Road, Durham (MAOP: 56 PSIG)' },
        { value: 'Gables Way (UNH)|56 PSIG', text: 'Gables Way (UNH) (MAOP: 56 PSIG)' },
        { value: 'Strafford Ave|56 PSIG', text: 'Strafford Ave (MAOP: 56 PSIG)' },
        { value: 'East Kingston|125 PSIG', text: 'East Kingston (MAOP: 125 PSIG)' },
        { value: 'Exeter IP|56 PSIG', text: 'Exeter IP (MAOP: 56 PSIG)' },
        { value: 'Guinea Road, Exeter|56 PSIG', text: 'Guinea Road, Exeter (MAOP: 56 PSIG)' },
        { value: 'Exeter-Hampton|171 PSIG', text: 'Exeter-Hampton (MAOP: 171 PSIG)' },
        { value: 'Route 88, Exeter|50 PSIG', text: 'Route 88, Exeter (MAOP: 50 PSIG)' },
        { value: 'Exeter/Brentwood Expansion|99 PSIG', text: 'Exeter/Brentwood Expansion (MAOP: 99 PSIG)' },
        { value: 'Fairway, Gonic|56 PSIG', text: 'Fairway, Gonic (MAOP: 56 PSIG)' },
        { value: 'Felker Street, Gonic|56 PSIG', text: 'Felker Street, Gonic (MAOP: 56 PSIG)' },
        { value: 'Gear Road, Gonic|56 PSIG', text: 'Gear Road, Gonic (MAOP: 56 PSIG)' },
        { value: 'Brox Line|99 PSIG', text: 'Brox Line (MAOP: 99 PSIG)' },
        { value: 'Rte 151, Greenland|56 PSIG', text: 'Rte 151, Greenland (MAOP: 56 PSIG)' },
        { value: 'Hampton IP|45 PSIG', text: 'Hampton IP (MAOP: 45 PSIG)' },
        { value: 'Liberty Lane, Hampton|45 PSIG', text: 'Liberty Lane, Hampton (MAOP: 45 PSIG)' },
        { value: 'Timber Swamp Rd, Hampton|60 PSIG', text: 'Timber Swamp Rd, Hampton (MAOP: 60 PSIG)' },
        { value: 'Exeter Rd/Falcone Circle|99 PSIG', text: 'Exeter Rd/Falcone Circle (MAOP: 99 PSIG)' },
        { value: 'Gale Road, Hampton|56 PSIG', text: 'Gale Road, Hampton (MAOP: 56 PSIG)' },
        { value: 'Heritage Drive, Hampton|56 PSIG', text: 'Heritage Drive, Hampton (MAOP: 56 PSIG)' },
        { value: 'Labrador Lane|99 PSIG', text: 'Labrador Lane (MAOP: 99 PSIG)' },
        { value: 'Hog\'s Hill, Kensington|99 PSIG', text: 'Hog\'s Hill, Kensington (MAOP: 99 PSIG)' },
        { value: 'Portsmouth IP|56 PSIG', text: 'Portsmouth IP (MAOP: 56 PSIG)' },
        { value: 'Plaistow, IP|56 PSIG', text: 'Plaistow, IP (MAOP: 56 PSIG)' },
        { value: 'Portsmouth LP|13.8 Inches W.C.', text: 'Portsmouth LP (MAOP: 13.8 Inches W.C.)' },
        { value: 'Portsmouth Lateral|270 PSIG', text: 'Portsmouth Lateral (MAOP: 270 PSIG)' },
        { value: 'Rochester IP|45 PSIG', text: 'Rochester IP (MAOP: 45 PSIG)' },
        { value: 'Aruba Drive, Rochester|99 PSIG', text: 'Aruba Drive, Rochester (MAOP: 99 PSIG)' },
        { value: 'Profile Apartments, Rochester|56 PSIG', text: 'Profile Apartments, Rochester (MAOP: 56 PSIG)' },
        { value: 'Salem IP|60 PSIG', text: 'Salem IP (MAOP: 60 PSIG)' },
        { value: 'Seabrook IP|56 PSIG', text: 'Seabrook IP (MAOP: 56 PSIG)' },
        { value: 'Andys Mobile Ct., Seabrook|56 PSIG', text: 'Andys Mobile Ct., Seabrook (MAOP: 56 PSIG)' },
        { value: 'Dog Track, Seabrook|56 PSIG', text: 'Dog Track, Seabrook (MAOP: 56 PSIG)' },
        { value: 'Oak Hill Mobile Pk, Somersworth|56 PSIG', text: 'Oak Hill Mobile Pk, Somersworth (MAOP: 56 PSIG)' },
        { value: 'Somersworth IP|50 PSIG', text: 'Somersworth IP (MAOP: 50 PSIG)' },
        { value: 'Rochester 150# line|150 PSIG', text: 'Rochester 150# line (MAOP: 150 PSIG)' },
        { value: 'Stratham Ind Park|56 PSIG', text: 'Stratham Ind Park (MAOP: 56 PSIG)' }
    ],
    'fge': [
        { value: '', text: 'Select FGE System...' },
        { value: 'Fitchburg LP|14 Inches W.C.', text: 'Fitchburg LP (MAOP: 14 Inches W.C.)' },
        { value: 'Fitchburg IP|20 PSIG', text: 'Fitchburg IP (MAOP: 20 PSIG)' },
        { value: 'Baltic Lane LP|14 Inches W.C.', text: 'Baltic Lane LP (MAOP: 14 Inches W.C.)' },
        { value: 'Gardner LP|14 Inches W.C.', text: 'Gardner LP (MAOP: 14 Inches W.C.)' },
        { value: 'Fitchburg HP|99 PSIG', text: 'Fitchburg HP (MAOP: 99 PSIG)' },
        { value: 'Depot Road|30 PSIG', text: 'Depot Road (MAOP: 30 PSIG)' }
    ]
};

// --- Form structure definition ---
const formSections: FormSectionData[] = [
    {
        title: "General Site & Crossing Information",
        id: "general-info",
        fields: [
            { label: "Date of Assessment:", id: "date-of-assessment", type: "date" },
            { label: "Assessment By:", id: "assessment-by", type: "text", placeholder: "e.g., John Doe" },
            {
                label: "District Operating Center (DOC):",
                id: "doc-select",
                type: "select",
                options: [
                    { value: "", text: "Select DOC..." },
                    { value: "bng", text: "Bangor Natural Gas" },
                    { value: "nu-me", text: "Northern Utilities - Maine" },
                    { value: "nu-nh", text: "Northern Utilities - New Hampshire" },
                    { value: "fge", text: "Fitchburg Gas and Electric" }
                ]
            },
            {
                label: "Crossing Identification Number:",
                id: "crossing-id",
                type: "text",
                placeholder: "e.g., BR-123, River St Bridge"
            },
            {
                label: "Town/City:",
                id: "town-city",
                type: "text",
                placeholder: "e.g., Hampton, NH"
            },
            {
                label: "Description of Crossing/Work Location:",
                id: "crossing-description",
                type: "textarea",
                placeholder: "Provide a brief description of the specific location, access points, or any immediate observations about the work area."
            },
            { label: "GPS Latitude:", id: "gps-lat", type: "text", placeholder: "e.g., 43.6591° N" },
            { label: "GPS Longitude:", id: "gps-lon", type: "text", placeholder: "e.g., 70.2568° W" },
        ]
    },
    {
        title: "Bridge & Environmental Context",
        id: "bridge-context",
        fields: [
            { label: "Road Name:", id: "road-name", type: "text", placeholder: "e.g., Main Street" },
            { label: "Feature Crossed:", id: "feature-crossed", type: "text", placeholder: "e.g., Saco River, I-95" },
            { label: "Bridge Name:", id: "bridge-name", type: "text", placeholder: "e.g., Main Street Bridge" },
            { label: "Bridge Number:", id: "bridge-number", type: "text", placeholder: "e.g., B78-002" },
            { 
                label: "Bridge Type:",
                id: "bridge-type",
                type: "select",
                options: [
                    { value: "", text: "Select Bridge Type..." },
                    { value: "girder", text: "Girder (Steel or Concrete)" },
                    { value: "beam", text: "Beam Bridge" },
                    { value: "truss", text: "Truss Bridge" },
                    { value: "arch", text: "Arch Bridge" },
                    { value: "suspension", text: "Suspension Bridge" },
                    { value: "cable-stayed", text: "Cable-Stayed Bridge" },
                    { value: "box-girder", text: "Box Girder Bridge" },
                    { value: "culvert", text: "Culvert" },
                    { value: "other", text: "Other" }
                ]
            },
            { 
                label: "Bridge Material:",
                id: "bridge-material",
                type: "select",
                options: [
                    { value: "", text: "Select Bridge Material..." },
                    { value: "steel", text: "Steel" },
                    { value: "concrete", text: "Concrete" },
                    { value: "prestressed-concrete", text: "Prestressed Concrete" },
                    { value: "wood", text: "Wood" },
                    { value: "composite", text: "Composite" },
                    { value: "masonry", text: "Masonry" },
                    { value: "wrought-iron", text: "Wrought Iron" },
                    { value: "other", text: "Other" }
                ]
            },
            { label: "Ambient Temperature at time of inspection (°F):", id: "ambient-temp", type: "number", placeholder: "e.g., 65" },
            { label: "General Weather Conditions:", id: "weather-conditions", type: "textarea", placeholder: "e.g., Sunny and clear, Overcast, Light rain" },
            { label: "Vegetation Growth Around Pipeline/Supports:", id: "vegetation-growth", type: "textarea", placeholder: "Describe vegetation, e.g., None, Minor, Overgrown, Trees/Roots impacting." },
            { label: "Evidence of Scour or Erosion Near Supports/Pipeline:", id: "scour-erosion", type: "textarea", placeholder: "Describe any scour or erosion observed." },
            { label: "Proximity to Water Body/Wetlands:", id: "proximity-water", type: "textarea", placeholder: "Describe proximity and any potential interaction." },
            { label: "Signs of Debris Accumulation Around Pipeline/Supports:", id: "debris-accumulation", type: "textarea", placeholder: "Describe any debris (logs, ice, trash) observed." }
        ]
    },
    {
        title: "Pipeline Identification & Specifications",
        id: "pipe-specs",
        fields: [
            {
                label: "System Name",
                id: "system-select",
                type: "select",
                options: [], // Dynamically populated
                containerId: 'system-select-container'
            },
            { label: "MAOP:", id: "maop", type: "text", placeholder: "Max. Allowable Operating Pressure" },
            { label: "Pipe Diameter (inches):", id: "pipe-diameter", type: "number", placeholder: "e.g., 4, 8, 12" },
            {
                label: "Wall Thickness (inches):",
                id: "wall-thickness",
                type: "number",
                placeholder: "e.g., 0.250",
                assessmentOptions: ["Assumed", "Measured", "Stamped on Pipe", "Obtained from records", "Unknown"],
                defaultAssessmentOption: "Unknown"
            },
            {
                label: "Comments on Wall Thickness:",
                id: "wall-thickness-comments",
                type: "textarea",
                placeholder: "Enter comments about wall thickness determination."
            },
            {
                label: "Pipe Material:",
                id: "pipe-material",
                type: "select",
                options: [
                    { value: "", text: "Select Material..." },
                    { value: "steel", text: "Steel" },
                    { value: "plastic", text: "Plastic (PE)" },
                    { value: "steel_in_casing", text: "Steel Carrier in Steel Casing" },
                    { value: "plastic_in_casing", text: "Plastic Carrier in Steel Casing" },
                    { value: "other", text: "Other" }
                ]
            },
            {
                label: "Pipe Grade:",
                id: "pipe-grade",
                type: "select",
                containerId: "pipe-grade-container",
                options: [
                    { value: "", text: "Select Pipe Grade..." },
                    { value: "24000", text: "24,000" },
                    { value: "35000", text: "35,000" },
                    { value: "x42", text: "X42" },
                    { value: "x52", text: "X52" },
                    { value: "x65", text: "X65" },
                    { value: "x72", text: "X72" }
                ]
            },
            {
                label: "Pipe Grade (Plastic):",
                id: "plastic-pipe-grade",
                type: "select",
                containerId: "plastic-pipe-grade-container",
                options: [
                    { value: "", text: "Select Plastic Grade..."},
                    { value: "mdpe", text: "MDPE" },
                    { value: "hdpe", text: "HDPE" }
                ]
            },
            {
                label: "SDR (Standard Dimension Ratio):",
                id: "pipe-sdr",
                type: "text",
                placeholder: "e.g., 11, 13.5",
                containerId: "pipe-sdr-container"
            },
            {
                label: "Installation Temperature (In Deg F.):",
                id: "installation-temp",
                type: "number",
                placeholder: "e.g., 55",
                assessmentOptions: ["Assumed", "Documented in Original Installation Records", "Derived from historical temperatures based on installation date"]
            },
        ]
    },
    {
        title: "Pipeline Support System",
        id: "support-system",
        fields: [
            {
                label: "Primary Support Method:",
                id: "support-method",
                type: "select",
                options: [
                    { value: "", text: "Select Support Method..." },
                    { value: "hangers", text: "Hangers from Bridge Structure" },
                    { value: "clevis-hanger", text: "Clevis Hanger" },
                    { value: "u-bolt-to-structure", text: "U-Bolt to Structure" },
                    { value: "rollers", text: "Roller Supports on Piers/Abutments" },
                    { value: "rollers-suspended", text: "Rollers Suspended from Above" },
                    { value: "double-rollers-suspended", text: "Double Rollers Suspended from Above" },
                    { value: "saddles", text: "Saddle Supports on Piers/Abutments" },
                    { value: "brackets", text: "Brackets Attached to Bridge Deck/Girders" },
                    { value: "pipe-stand", text: "Pipe Stand/Stanchion on Deck" },
                    { value: "self-supporting", text: "Self-Supporting Span (e.g., dedicated pipe bridge)" },
                    { value: "other", text: "Other (Specify Below)" }
                ]
            },
            { label: "Specify Other Support Method:", id: "other-support-specify", type: "textarea", placeholder: "Describe if 'Other' was selected." },
            { label: "Comments on Support Condition (Thermal Stress):", id: "support-condition-thermal-stress-comments", type: "textarea", placeholder: "Note any signs of thermal stress, such as bent supports or strained connections." },
            { label: "Comments on Pipe Movement/Restriction at Supports:", id: "pipe-movement-at-supports-comments", type: "textarea", placeholder: "Assess if the pipe is free to move as designed or if it is unduly restricted." },
            { label: "Comments on Sliding/Roller Support Functionality:", id: "sliding-roller-functionality-comments", type: "textarea", placeholder: "Check for proper lubrication, seizure, or debris impeding movement on sliding/roller supports." },
            { label: "Comments on Pipeline Support & Attachment (General):", id: "support-comments", type: "textarea", placeholder: "General condition of hangers, U-bolts, clamps, welds, and fasteners." }
        ]
    },
    {
        title: "Expansion/Contraction Provisions",
        id: "expansion-provisions",
        fields: [
            {
                label: "Expansion/Contraction Features:",
                id: "expansion-feature",
                type: "checkbox-group",
                checkboxOptions: [
                    { value: "expansion_loop", text: "Expansion Loop" },
                    { value: "expansion_joint", text: "Expansion Joint (e.g., bellows, slip-type)" },
                    { value: "pipe_flexibility", text: "Designed Pipe Flexibility (offsets, bends)" },
                    { value: "mechanical_joint", text: "Mechanical Joint / Coupling" },
                    { value: "none", text: "None Observed" },
                    { value: "eval_by_eng", text: "To be evaluated by Gas Engineering" },
                    { value: "other", text: "Other (Specify Below)" }
                ]
            },
            { label: "Specify Other Expansion Feature:", id: "other-expansion-specify", type: "textarea", placeholder: "Describe if 'Other' was selected." },
            { label: "Comments on Expansion Feature Functionality:", id: "expansion-feature-functionality-comments", type: "textarea", placeholder: "Assess if the feature is functioning as intended (e.g., loop is not restrained, joint is not seized)." },
            { label: "Comments on Expansion/Contraction Accommodation (General):", id: "expansion-comments", type: "textarea", placeholder: "Overall assessment of how thermal movement is managed across the crossing." }
        ]
    },
    {
        title: "Coating and Corrosion Control",
        id: "corrosion-control",
        fields: [
            {
                label: "Coating Type:",
                id: "coating-type",
                type: "select",
                options: [
                    { value: "", text: "Select Coating Type..." },
                    { value: "fusion-bonded-epoxy", text: "Fusion Bonded Epoxy" },
                    { value: "pritec", text: "Pritec" },
                    { value: "x-tru-coat", text: "X-Tru-Coat" },
                    { value: "painted", text: "Painted" },
                    { value: "wax-taped", text: "Wax Taped" },
                    { value: "wrapped", text: "Wrapped" },
                    { value: "other", text: "Other" }
                ]
            },
            { label: "Specify Other Coating Type:", id: "other-coating-type-specify", type: "textarea", placeholder: "Describe if 'Other' was selected." },
            { label: "Comments on Coating:", id: "coating-comments", type: "textarea", placeholder: "Describe condition: holidays, disbondment, mechanical damage, UV degradation." }
        ]
    },
    {
        title: "Pipe Condition Assessment",
        id: "pipe-condition",
        fields: [
            { label: "Evidence of Physical Damage to Pipe (dents, gouges, etc.):", id: "pipe-physical-damage", type: "textarea", placeholder: "Describe location, size, and severity of any physical damage found." },
            { label: "Atmospheric Corrosion: Extent and Severity (if steel pipe exposed):", id: "atmospheric-corrosion-details", type: "textarea", placeholder: "Describe any atmospheric corrosion, classifying as light, moderate, or severe." }
        ]
    },
    {
        title: "Clearances and Measurements",
        id: "clearances",
        fields: [
            {
                label: "Clearances:",
                id: "clearance-group",
                type: "clearance-group",
                options: [
                    { value: "v-hwy", text: "Vertical clearance from highway/roadway" },
                    { value: "h-hwy", text: "Horizontal clearance from highway/roadway" },
                    { value: "v-water", text: "Vertical clearance from high water mark" },
                    { value: "h-abutment", text: "Horizontal clearance from bridge abutments" }
                ]
            },
            { label: "Comments on Clearances and Measurements:", id: "clearance-comments", type: "textarea", placeholder: "Record actual measurements and note any deficiencies." }
        ]
    },
    {
        title: "Access and Safety",
        id: "access-safety",
        fields: [
            { label: "Safety Hazards Noted (e.g., traffic, fall hazards, confined space):", id: "safety-hazards", type: "textarea", placeholder: "Describe any safety hazards observed during the assessment." },
            { label: "Condition of Access Structures (ladders, walkways, etc.):", id: "access-structures-condition", type: "textarea", placeholder: "Describe the condition of any structures used to access the pipeline." },
            { label: "Comments on Access & Safety:", id: "access-safety-comments", type: "textarea", placeholder: "General comments on accessibility for inspection and maintenance." }
        ]
    },
    {
        title: "Documentation",
        id: "documentation",
        fields: [
            {
                label: "Upload Photographs/Sketches:",
                id: "photographs",
                type: "file",
                multiple: true,
                accept: "image/jpeg,image/png,image/tiff"
            },
            {
                label: "Upload Other Documents (e.g., Installation Records):",
                id: "other-docs",
                type: "file",
                multiple: true,
                accept: "image/jpeg,image/png,image/tiff"
            }
        ]
    },
    {
        title: "Third-Party Infrastructure and General Observations",
        id: "third-party",
        fields: [
            { label: "Other Utilities or Structures Attached to/Near Bridge:", id: "other-utilities-bridge", type: "textarea", placeholder: "Describe any other utilities (electric, water, telecom) or structures present." },
            { label: "Observed Condition of Bridge Structure (General):", id: "bridge-structure-condition", type: "textarea", placeholder: "Note any significant deterioration, damage, or concerns about the bridge itself." },
            { label: "Potential for Third-Party Damage to Pipeline:", id: "third-party-damage-potential", type: "textarea", placeholder: "Assess potential for damage from traffic, mowers, or other activities." },
            { label: "Comments on Third-Party Infrastructure:", id: "third-party-comments", type: "textarea", placeholder: "General comments on the condition and proximity of other infrastructure." }
        ]
    },
    {
        title: "Recommendations and Final Evaluation",
        id: "recommendations",
        fields: [
            { label: "Any Immediate Hazards Identified (requiring urgent attention):", id: "immediate-hazards", type: "textarea", placeholder: "Describe any conditions that pose an immediate risk." },
            { label: "Actions Taken/Notification Made (if any immediate hazards):", id: "actions-taken-hazards", type: "textarea", placeholder: "Detail any on-the-spot actions or notifications made." },
            {
                label: "Recommendation Priority:",
                id: "recommendation-priority",
                type: "select",
                options: [
                    { value: "", text: "Select Priority Level..." },
                    { value: "immediate", text: "Immediate (within 24 hours)" },
                    { value: "high", text: "High (within 1 month)" },
                    { value: "medium", text: "Medium (within 6 months)" },
                    { value: "low", text: "Low (within 1 year / next inspection cycle)" }
                ]
            },
            { label: "Summary of Recommendations / Specify \"Other\" / Timeline:", id: "recommendations-summary", type: "textarea", placeholder: "List specific, actionable recommendations." },
            { label: "Final Summary of Evaluation:", id: "final-summary-evaluation", type: "textarea", placeholder: "Provide an overall summary of the crossing's condition." }
        ]
    }
];

// --- Gets all form data in a structured way ---
function getFormData() {
    const data: { [key: string]: any } = {};
    const form = document.getElementById('assessment-form') as HTMLFormElement;
    if (!form) return data;

    formSections.forEach(section => {
        section.fields.forEach(field => {
            if (field.type === 'file') {
                return;
            }

            if (field.type === 'clearance-group') {
                if (field.options) {
                    field.options.forEach(opt => {
                        const valueId = `${field.id}-${opt.value}-value`;
                        const unitId = `${field.id}-${opt.value}-units`;
                        const valueEl = document.getElementById(valueId) as HTMLInputElement;
                        const unitEl = document.getElementById(unitId) as HTMLSelectElement;

                        if (valueEl && valueEl.value) {
                            data[valueId] = valueEl.value;
                            data[unitId] = unitEl.value;
                        }
                    });
                }
                return; // continue to next field
            }

            if (field.id === 'expansion-feature') {
                const featureData: { [key: string]: number } = {};
                const checkedInputs = form.querySelectorAll<HTMLInputElement>(`input[name="${field.id}"]:checked`);
                checkedInputs.forEach(input => {
                    const quantityInput = document.getElementById(`${input.id}-quantity`) as HTMLInputElement;
                    if (quantityInput && quantityInput.value) {
                        const quantity = parseInt(quantityInput.value, 10);
                        if (!isNaN(quantity) && quantity > 0) {
                            featureData[input.value] = quantity;
                        }
                    } else {
                         featureData[input.value] = 1;
                    }
                });
                data[field.id] = featureData;
            } else if (field.type === 'checkbox-group') {
                const checkedInputs = form.querySelectorAll<HTMLInputElement>(`input[name="${field.id}"]:checked`);
                data[field.id] = Array.from(checkedInputs).map(input => input.value);
            } else if (field.type === 'radio-group') {
                const checkedInput = form.querySelector<HTMLInputElement>(`input[name="${field.id}"]:checked`);
                data[field.id] = checkedInput ? checkedInput.value : '';
            } else {
                const element = document.getElementById(field.id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
                if (element) {
                    // For conditional fields, only record if their container is visible
                    if (field.containerId) {
                        const container = document.getElementById(field.containerId);
                        if (container && container.style.display !== 'none') {
                           data[field.id] = element.value;
                        }
                    } else {
                       data[field.id] = element.value;
                    }
                } else {
                    data[field.id] = '';
                }
            }

            if (field.assessmentOptions) {
                const assessmentKey = `${field.id}-assessment`;
                const checkedInput = form.querySelector<HTMLInputElement>(`input[name="${assessmentKey}"]:checked`);
                data[assessmentKey] = checkedInput ? checkedInput.value : '';
            }
        });
    });

    return data;
}


// --- Main Application Logic ---
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('assessment-form') as HTMLFormElement;
    const guidelinesContainer = document.getElementById('process-guidelines-container') as HTMLElement;
    const saveButton = document.getElementById('save-assessment-button') as HTMLButtonElement;
    const openButton = document.getElementById('open-assessment-button') as HTMLButtonElement;
    const openFileInput = document.getElementById('open-file-input') as HTMLInputElement;
    const generateReportButton = document.getElementById('generate-report-button') as HTMLButtonElement;
    const exampleButton = document.getElementById('example-assessment-button') as HTMLButtonElement;
    const tabForm = document.getElementById('tab-form') as HTMLButtonElement;
    const tabProcess = document.getElementById('tab-process') as HTMLButtonElement;
    const formContainer = document.getElementById('assessment-form-container') as HTMLElement;
    const processContainer = document.getElementById('process-guidelines-container') as HTMLElement;
    const adminPasswordInput = document.getElementById('admin-password') as HTMLInputElement;
    const adminUnlockButton = document.getElementById('admin-unlock-button') as HTMLButtonElement;
    const adminUnlockContainer = document.getElementById('admin-unlock-container') as HTMLElement;
    const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
    const apiKeyToggle = document.getElementById('api-key-toggle') as HTMLButtonElement;


    function populateForm() {
        formSections.forEach(sectionData => {
            const sectionEl = document.createElement('div');
            sectionEl.classList.add('form-section');
            sectionEl.id = sectionData.id;

            const titleEl = document.createElement('h2');
            const sectionNumber = document.createElement('span');
            sectionNumber.className = 'section-number';
            sectionNumber.textContent = `${formSections.indexOf(sectionData) + 1}`;
            titleEl.appendChild(sectionNumber);
            titleEl.appendChild(document.createTextNode(sectionData.title));
            sectionEl.appendChild(titleEl);

            sectionData.fields.forEach(field => {
                const fieldEl = createFieldElement(field);
                sectionEl.appendChild(fieldEl);
            });

            form.appendChild(sectionEl);
        });
        
        // Add event listeners for conditional logic
        const docSelect = document.getElementById('doc-select') as HTMLSelectElement;
        if (docSelect) {
            docSelect.addEventListener('change', handleDocChange);
        }
        
        const systemSelect = document.getElementById('system-select') as HTMLSelectElement;
        if (systemSelect) {
            systemSelect.addEventListener('change', handleSystemChange);
        }

        const pipeMaterialSelect = document.getElementById('pipe-material') as HTMLSelectElement;
        if (pipeMaterialSelect) {
            pipeMaterialSelect.addEventListener('change', handlePipeMaterialChange);
        }
    }
    
    function handleDocChange() {
        const docSelect = document.getElementById('doc-select') as HTMLSelectElement;
        const systemSelect = document.getElementById('system-select') as HTMLSelectElement;
        const systemContainer = document.getElementById('system-select-container') as HTMLElement;
        const maopInput = document.getElementById('maop') as HTMLInputElement;
        const selectedDoc = docSelect.value as keyof typeof systemData;
    
        const options = systemData[selectedDoc] || [];
    
        // Clear previous options
        systemSelect.innerHTML = '';
    
        // Populate new options
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (opt.value === '') {
                option.disabled = true;
                option.selected = true;
            }
            systemSelect.appendChild(option);
        });
    
        // Show or hide the container
        if (options.length > 0) {
            systemContainer.style.display = 'block';
        } else {
            systemContainer.style.display = 'none';
        }
    
        // Reset MAOP
        maopInput.value = '';
    }

    function handleSystemChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        const selectedValue = select.value;
        const maopInput = document.getElementById('maop') as HTMLInputElement;

        if (selectedValue && selectedValue.includes('|')) {
            const [, maop] = selectedValue.split('|');
            maopInput.value = maop;
        } else {
            maopInput.value = '';
        }
    }

    function handlePipeMaterialChange() {
        const materialSelect = document.getElementById('pipe-material') as HTMLSelectElement;
        if (!materialSelect) return;
        const materialValue = materialSelect.value;

        const steelGradeContainer = document.getElementById('pipe-grade-container');
        const plasticGradeContainer = document.getElementById('plastic-pipe-grade-container');
        const sdrContainer = document.getElementById('pipe-sdr-container');

        const steelGradeInput = document.getElementById('pipe-grade') as HTMLSelectElement;
        const plasticGradeInput = document.getElementById('plastic-pipe-grade') as HTMLSelectElement;
        const sdrInput = document.getElementById('pipe-sdr') as HTMLInputElement;
        
        // Hide all conditional fields by default
        if (steelGradeContainer) steelGradeContainer.style.display = 'none';
        if (plasticGradeContainer) plasticGradeContainer.style.display = 'none';
        if (sdrContainer) sdrContainer.style.display = 'none';

        if (materialValue === 'steel' || materialValue === 'steel_in_casing') {
            if (steelGradeContainer) steelGradeContainer.style.display = 'block';
            // Clear plastic fields
            if (plasticGradeInput) plasticGradeInput.value = '';
            if (sdrInput) sdrInput.value = '';
        } else if (materialValue === 'plastic' || materialValue === 'plastic_in_casing') {
            if (plasticGradeContainer) plasticGradeContainer.style.display = 'block';
            if (sdrContainer) sdrContainer.style.display = 'block';
            // Clear steel field
            if (steelGradeInput) steelGradeInput.value = '';
        } else {
            // For 'Other' or no selection, clear all conditional fields
            if (steelGradeInput) steelGradeInput.value = '';
            if (plasticGradeInput) plasticGradeInput.value = '';
            if (sdrInput) sdrInput.value = '';
        }
    }

    function populateProcessGuidelines() {
        guidelinesContainer.innerHTML = `
            <h2>Process Guidelines for Pipeline Bridge Crossing Assessment</h2>
            <p>This document provides guidance on completing the UNITIL Natural Gas Pipeline Bridge Crossing Assessment Form. The objective is to ensure a consistent, thorough, and safe evaluation of all pipeline assets at bridge crossings.</p>

            <h3>General Principles</h3>
            <ul>
                <li><strong>Safety First:</strong> Always prioritize personal and public safety. Assess traffic conditions, potential fall hazards, and environmental risks before beginning the inspection. Wear appropriate Personal Protective Equipment (PPE).</li>
                <li><strong>Thoroughness:</strong> Complete all applicable sections of the form. Use the "Comments" fields to provide detailed descriptions, especially for any noted deficiencies or unusual conditions.</li>
                <li><strong>Documentation:</strong> Photographs are critical. Capture images of the overall crossing, specific components (supports, coating, etc.), and any identified areas of concern. Ensure photos are well-lit and in focus.</li>
            </ul>

            <h3>On-Site Assessment Walkthrough</h3>
            <p>Follow the sections of the form in order to ensure a logical workflow.</p>

            <h4>1. General Site & Crossing Information</h4>
            <p>Establish the basic details of the assessment location.</p>
            <ul>
                <li><strong>Date and Assessor:</strong> Record the date of the inspection and the full name of the lead assessor.</li>
                <li><strong>District Operating Center (DOC):</strong> Select the correct operating company and region. This will populate the relevant system names in Section 3.</li>
                <li><strong>Crossing ID & Town/City:</strong> Use the official company crossing identifier if available and enter the town or city where the crossing is located.</li>
                <li><strong>Description:</strong> The description should be concise but sufficient for another person to find the exact location (e.g., "Pipeline attached to west side of Main Street Bridge over Saco River").</li>
                <li><strong>GPS Coordinates:</strong> Use a reliable GPS device to capture the latitude and longitude at the approximate center of the crossing.</li>
            </ul>

            <h4>2. Bridge & Environmental Context</h4>
            <p>Describe the structure and environment affecting the pipeline.</p>
            <ul>
                <li><strong>Bridge Details:</strong> Record the road name, feature crossed (river, highway, etc.), and official bridge name/number if posted.</li>
                <li><strong>Bridge Type/Material:</strong> Select the best descriptions. This context is important for understanding potential interactions between the pipe and bridge.</li>
                <li><strong>Ambient Temperature & Weather:</strong> Record the temperature and general conditions. This is vital for understanding thermal expansion/contraction at the time of inspection.</li>
                <li><strong>Environmental Factors:</strong> Carefully document vegetation, scour/erosion, water proximity, and debris. These can impose stress on the pipeline or impede access.</li>
            </ul>

            <h4>3. Pipeline Identification & Specifications</h4>
            <p>Detail the physical characteristics of the pipeline asset.</p>
            <ul>
                <li><strong>System Name & MAOP:</strong> After selecting a DOC in Section 1, choose the correct system from the dropdown. The MAOP will auto-populate. Verify this against records if possible.</li>
                <li><strong>Pipe Details:</strong> Record the diameter, wall thickness, and material. If unknown, state "Unknown". For Wall Thickness, specify how the value was determined (e.g., measured, from records). For Pipe Material, select the appropriate option. This will reveal relevant fields like Pipe Grade (for steel) or Plastic Grade and SDR (for plastic).</li>
                <li><strong>Installation Temperature:</strong> This is a key input for stress calculations. Use installation records if available. If not, select the appropriate source: "Assumed" or "Derived" based on historical weather data for the installation year.</li>
            </ul>
            
            <h4>4. Pipeline Support System</h4>
            <p>Evaluate how the pipeline is supported across the span.</p>
            <ul>
                <li><strong>Support Method:</strong> Identify the primary method used.</li>
                <li><strong>Comments on Condition:</strong> This is a critical section. Look for signs of stress (bending, twisting), restricted movement (seized rollers), and general degradation (corrosion, loose fasteners).</li>
            </ul>
            
            <h4>5. Expansion/Contraction Provisions</h4>
            <p>Assess the features designed to manage thermal movement.</p>
            <ul>
                <li><strong>Feature Identification:</strong> Identify the expansion loop, joint, or other design feature. Note the quantity of each.</li>
                <li><strong>Functionality Comments:</strong> Determine if the feature can move as intended. Is an expansion loop filled with debris? Is a joint leaking or seized?</li>
            </ul>

            <h4>6. Coating and Corrosion Control</h4>
            <p>Examine the primary line of defense against corrosion.</p>
            <ul>
                <li><strong>Coating Type & Condition:</strong> Identify the coating and meticulously document any damage, holidays, disbondment, or degradation.</li>
            </ul>

            <h4>7. Pipe Condition Assessment</h4>
            <p>Directly inspect the pipe steel/material itself.</p>
            <ul>
                <li><strong>Physical Damage:</strong> Look for any dents, gouges, or scrapes from third-party contact or debris. Describe location and size.</li>
                <li><strong>Atmospheric Corrosion:</strong> If pipe steel is exposed, describe the extent and severity of any atmospheric corrosion.</li>
            </ul>
            
            <h4>8. Clearances and Measurements</h4>
            <p>Verify the pipeline's position relative to its surroundings.</p>
            <ul>
                <li><strong>Clearance Checks:</strong> For each item, enter the measured distance and select the appropriate units (feet or inches). Note any deficiencies in the comments field.</li>
            </ul>

            <h4>9. Access and Safety</h4>
            <p>Evaluate the safety of the site for current and future work.</p>
            <ul>
                <li><strong>Hazards & Access:</strong> Document any immediate safety hazards. Assess the condition of any permanent access structures like ladders or walkways. Comment on the general ease or difficulty of accessing the pipeline.</li>
            </ul>
            
            <h4>10. Documentation</h4>
            <p>Upload the visual evidence collected during the inspection.</p>
            <ul>
                <li><strong>Photographs:</strong> Upload all relevant photos. Use the comment field for each photo to add a descriptive caption (e.g., "Upstream view of crossing," "Corrosion on support #3").</li>
                <li><strong>Other Documents:</strong> Upload any relevant documents, such as previous inspection reports or sketches made on-site.</li>
            </ul>

            <h4>11. Third-Party Infrastructure and General Observations</h4>
            <p>Note any other factors that could impact the pipeline.</p>
            <ul>
                <li><strong>Other Utilities & Bridge Condition:</strong> Document other utilities on the bridge. Note any major defects in the bridge structure itself that could eventually affect the pipeline.</li>
                <li><strong>Third-Party Damage:</strong> Assess the potential for future damage from vandalism, or other activities.</li>
            </ul>
            
            <h4>12. Recommendations and Final Evaluation</h4>
            <p>Synthesize findings into actionable recommendations.</p>
            <ul>
                <li><strong>Immediate Hazards:</strong> Clearly list anything requiring immediate attention. Document who was notified and when.</li>
                <li><strong>Recommendation Priority:</strong> Assign a priority level to guide maintenance scheduling. This is a critical output of the assessment.</li>
                <li><strong>Summary of Recommendations:</strong> List clear, actionable recommendations (e.g., "Repair coating at support #3," "Clear vegetation from east abutment").</li>
                <li><strong>Final Summary:</strong> Provide a brief, high-level summary of the overall condition of the pipeline crossing.</li>
            </ul>`;
    }

    function handleSaveAssessment() {
        const formData = getFormData();
        formData['fileData'] = fileDataStore;

        const dataStr = JSON.stringify(formData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().split('T')[0];
        a.download = `pipeline-assessment-${formData['crossing-id'] || 'untitled'}-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function handleOpenAssessment() {
        openFileInput.click();
    }

    function loadAssessmentFile(event: Event) {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target?.result as string);
                    populateFormWithData(data);
                } catch (error) {
                    console.error("Error parsing assessment file:", error);
                    alert("Could not open the assessment file. It may be corrupted or in the wrong format.");
                }
            };
            reader.readAsText(file);
        }
        // Reset file input to allow opening the same file again
        openFileInput.value = "";
    }
    
    function populateFormWithData(data: { [key: string]: any }) {
        // First, handle the DOC and dependent system select
        if (data['doc-select']) {
            const docSelect = document.getElementById('doc-select') as HTMLSelectElement;
            docSelect.value = data['doc-select'];
            handleDocChange(); // This populates the system-select options
        }

        Object.keys(data).forEach(key => {
            if (key === 'fileData') {
                const loadedFileData = data[key];
                Object.keys(loadedFileData).forEach(inputId => {
                    fileDataStore[inputId] = loadedFileData[inputId];
                    renderFileList(inputId);
                });
                return;
            }
            
            const element = document.getElementById(key) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            if (element) {
                if ((element as HTMLInputElement).type === 'radio') {
                    // Handled by name below
                } else if ((element as HTMLInputElement).type === 'checkbox') {
                    // Handled by name below
                } else {
                    element.value = data[key];
                     if (element.tagName === 'TEXTAREA') {
                       setTimeout(() => autoResizeTextarea(element as HTMLTextAreaElement), 0);
                    }
                }
            }
            
            // Handle radio and checkbox groups by name
            const elementsByName = document.getElementsByName(key);
            if (elementsByName.length > 0) {
                const firstEl = elementsByName[0] as HTMLInputElement;
                if (firstEl.type === 'radio') {
                    for (const el of Array.from(elementsByName) as HTMLInputElement[]) {
                        if (el.value === data[key]) {
                            el.checked = true;
                            break;
                        }
                    }
                } else if (firstEl.type === 'checkbox') {
                    if (key === 'expansion-feature' && typeof data[key] === 'object' && !Array.isArray(data[key]) && data[key] !== null) {
                        const featureData = data[key] as { [key: string]: number };
                        Object.entries(featureData).forEach(([featureValue, quantity]) => {
                            const checkboxId = `${key}-${featureValue.toLowerCase().replace(/\s+/g, '-')}`;
                            const checkbox = document.getElementById(checkboxId) as HTMLInputElement;
                            const quantityInput = document.getElementById(`${checkboxId}-quantity`) as HTMLInputElement;
                            if (checkbox && quantityInput) {
                                checkbox.checked = true;
                                quantityInput.value = String(quantity);
                                quantityInput.style.display = 'inline-block';
                            }
                        });
                    } else {
                        const values = Array.isArray(data[key]) ? data[key] : [];
                        for (const el of Array.from(elementsByName) as HTMLInputElement[]) {
                           el.checked = values.includes(el.value);
                        }
                    }
                }
            }
        });

        // Trigger the system change to set MAOP if a system is selected
        const systemSelect = document.getElementById('system-select') as HTMLSelectElement;
        if (systemSelect.value) {
            handleSystemChange({ target: systemSelect } as unknown as Event);
        }

        // Trigger pipe material change to show/hide relevant fields
        handlePipeMaterialChange();
    }
    
    function generateTextSummaryForAI(formData: { [key: string]: any }, sectionsToSummarize?: FormSectionData[]): string {
        let summary = "Assessment Data Summary:\n";
        const sections = sectionsToSummarize || formSections;

        sections.forEach(section => {
            let sectionHasContent = false;
            let sectionSummary = '';
            section.fields.forEach(field => {
                 if (field.type === 'file') return;

                // Skip conditional fields that are not visible
                if (field.containerId) {
                    const container = document.getElementById(field.containerId);
                    if (container && container.style.display === 'none') {
                        return;
                    }
                }
                
                const rawValue = formData[field.id];
                let displayValue: string | null = null;
                let fieldLabel = field.label;
                
                if (field.type === 'clearance-group') {
                    if (field.options) {
                        field.options.forEach(opt => {
                            const valueId = `${field.id}-${opt.value}-value`;
                            const unitId = `${field.id}-${opt.value}-units`;
                            if (formData[valueId]) {
                                sectionSummary += `${opt.text}: ${formData[valueId]} ${formData[unitId]}\n`;
                                sectionHasContent = true;
                            }
                        });
                    }
                    return;
                }
                
                if (field.id === 'expansion-feature') {
                    const featureData = rawValue;
                    if (typeof featureData === 'object' && featureData !== null && Object.keys(featureData).length > 0) {
                        displayValue = Object.entries(featureData).map(([value, count]) => {
                            const optionText = field.checkboxOptions?.find(opt => opt.value === value)?.text || value;
                            return `${optionText} (Qty: ${count})`;
                        }).join(', ');
                    }
                } else if (rawValue !== undefined && rawValue !== null && rawValue !== '' && (!Array.isArray(rawValue) || rawValue.length > 0) ) {
                     if(Array.isArray(rawValue)) {
                        displayValue = rawValue.join(', ');
                    } else if (field.type === 'select') {
                        let currentOptions = field.options || [];
                        if (field.id === 'system-select') {
                            const docValue = formData['doc-select'] as keyof typeof systemData;
                            currentOptions = systemData[docValue] || [];
                        }
                        const selectedOption = currentOptions.find(opt => opt.value === String(rawValue));
                        displayValue = selectedOption ? selectedOption.text : String(rawValue).split('|')[0];
                    } else {
                        displayValue = String(rawValue);
                    }
                }

                if (displayValue) {
                   sectionSummary += `${fieldLabel} ${displayValue}\n`;
                   sectionHasContent = true;
                }

                if(field.assessmentOptions) {
                    const assessmentKey = `${field.id}-assessment`;
                    const assessmentValue = formData[assessmentKey];
                    if (assessmentValue) {
                        sectionSummary += `${fieldLabel} (Source): ${assessmentValue}\n`;
                        sectionHasContent = true;
                    }
                }
            });
            if (sectionHasContent) {
                summary += `\n--- ${section.title} ---\n`;
                summary += sectionSummary;
            }
        });
        
        if (!sectionsToSummarize) {
            summary += "\n--- Attached File Comments ---\n";
            Object.keys(fileDataStore).forEach(inputId => {
               if (fileDataStore[inputId].length > 0) {
                   summary += `${inputId}:\n`;
                   fileDataStore[inputId].forEach(file => {
                       summary += `- ${file.name}: ${file.comment || 'No comment'}\n`;
                   });
               }
            });
        }

        return summary;
    }

    async function handleGenerateReport() {
        const apiKey = getApiKey();
        if (!apiKey) {
            alert("Please enter your Google AI API Key to generate a report with AI summaries.");
            document.getElementById('api-key-input')?.focus();
            return;
        }

        const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
        const loadingText = document.getElementById('loading-text') as HTMLElement;
        const modal = document.getElementById('summary-review-modal') as HTMLElement;
        const execSummaryTextarea = document.getElementById('modal-exec-summary') as HTMLTextAreaElement;
        const finalSummaryTextarea = document.getElementById('modal-final-summary') as HTMLTextAreaElement;
        
        loadingText.textContent = "Generating...";
        loadingOverlay.style.display = 'flex';

        const formData = getFormData();
        const fullTextSummary = generateTextSummaryForAI(formData);

        // --- AI Generation ---
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const execSummaryPrompt = `Based on the following pipeline bridge crossing assessment data, write a concise, professional Executive Summary suitable for the first page of an engineering report. Focus on the overall condition, any immediate or high-priority findings, and the general recommendation. Data:\n${fullTextSummary}`;
        const finalSummaryPrompt = `Based on the following pipeline bridge crossing assessment data, write a comprehensive "Final Summary of Evaluation". This should synthesize all key findings from the report into a detailed concluding paragraph. Data:\n${fullTextSummary}`;
        
        const sectionTitles = formSections.map(s => s.title);
        const sectionSummariesPrompt = `Based on the full assessment data below, provide a single-sentence summary for each section title provided. Return a JSON object where each key is an exact section title and the value is its summary. If a section has no relevant data or findings, return an empty string for its value. Section titles: ${JSON.stringify(sectionTitles)}. Full Data: \n${fullTextSummary}`;

        const promises = [
            ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: execSummaryPrompt }),
            ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: finalSummaryPrompt }),
            ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: sectionSummariesPrompt, config: { responseMimeType: 'application/json' }})
        ];

        const [execResult, finalResult, sectionSummariesResult] = await Promise.allSettled(promises);

        loadingOverlay.style.display = 'none';

        // --- Populate Modal ---
        execSummaryTextarea.value = (execResult.status === 'fulfilled') 
            ? execResult.value.text 
            : `Warning: Could not connect to the AI service to generate summary. Please write it manually.`;

        finalSummaryTextarea.value = (finalResult.status === 'fulfilled') 
            ? finalResult.value.text 
            : `Warning: Could not connect to the AI service to generate summary. Please write it manually.`;
            
        let sectionSummaries: { [key: string]: string } = {};
        if (sectionSummariesResult.status === 'fulfilled') {
            try {
                let jsonStr = sectionSummariesResult.value.text.trim();
                const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
                const match = jsonStr.match(fenceRegex);
                if (match && match[2]) {
                  jsonStr = match[2].trim();
                }
                sectionSummaries = JSON.parse(jsonStr);
            } catch (e) {
                console.error("Failed to parse section summaries JSON:", e);
            }
        }
        
        autoResizeTextarea(execSummaryTextarea);
        autoResizeTextarea(finalSummaryTextarea);

        modal.style.display = 'flex';
        
        // Add improve buttons if admin
        if (document.body.classList.contains('voice-enabled')) {
            addImproveButton(document.getElementById('modal-exec-summary-wrapper')!, execSummaryTextarea);
            addImproveButton(document.getElementById('modal-final-summary-wrapper')!, finalSummaryTextarea);
        }

        const modalGeneratePdfButton = document.getElementById('modal-generate-pdf-button')!;
        const modalCancelButton = document.getElementById('modal-cancel-button')!;
        
        const newGenerateButton = modalGeneratePdfButton.cloneNode(true);
        modalGeneratePdfButton.parentNode!.replaceChild(newGenerateButton, modalGeneratePdfButton);
        
        const newCancelButton = modalCancelButton.cloneNode(true);
        modalCancelButton.parentNode!.replaceChild(newCancelButton, modalCancelButton);


        const generatePdfHandler = () => {
            modal.style.display = 'none';
            buildPdfDocument(formData, execSummaryTextarea.value, finalSummaryTextarea.value, sectionSummaries);
        };

        const cancelHandler = () => {
            modal.style.display = 'none';
        };
        
        newGenerateButton.addEventListener('click', generatePdfHandler);
        newCancelButton.addEventListener('click', cancelHandler);
    }
    
    async function buildPdfDocument(formData: { [key: string]: any }, execSummary: string, finalSummary: string, sectionSummaries: { [key: string]: string }) {
        const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
        const loadingText = document.getElementById('loading-text') as HTMLElement;
        loadingText.textContent = "Generating...";
        loadingOverlay.style.display = 'flex';

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 15;
            let cursorY = margin;
            
            formData['final-summary-evaluation'] = finalSummary;

            const addHeaderFooter = () => {
                const pageCount = doc.internal.getNumberOfPages();
                for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(10);
                    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
                }
            };
            
            // --- Title Page ---
            doc.setFontSize(22);
            doc.setFont('helvetica', 'bold');
            doc.text('UNITIL Pipeline Bridge Crossing Assessment Report', pageWidth / 2, cursorY, { align: 'center' });
            cursorY += 20;

            const docField = formSections.find(s => s.id === 'general-info')?.fields.find(f => f.id === 'doc-select');
            const docValue = formData['doc-select'];
            const docText = docField?.options?.find(opt => opt.value === docValue)?.text || 'N/A';

            doc.setFontSize(12);
            doc.setFont('helvetica', 'normal');
            doc.text(`Crossing ID: ${formData['crossing-id'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            doc.text(`Bridge Name: ${formData['bridge-name'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            doc.text(`Town/City: ${formData['town-city'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            doc.text(`District Operating Center: ${docText}`, margin, cursorY);
            cursorY += 7;
            doc.text(`Date of Assessment: ${formData['date-of-assessment'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            doc.text(`Assessed By: ${formData['assessment-by'] || 'N/A'}`, margin, cursorY);
            cursorY += 15;

            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Executive Summary', margin, cursorY);
            cursorY += 8;

            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            const summaryLines = doc.splitTextToSize(execSummary, pageWidth - margin * 2);
            doc.text(summaryLines, margin, cursorY);
            
            doc.addPage();
            
            // --- Data Table Page(s) ---
            const tocEntries: {title: string, page: number, summary?: string}[] = [];
            const reportData: (string | { content: string; styles: { fontStyle: 'bold' | 'normal' | 'italic', halign?: 'left' | 'center' | 'right' } })[][] = [];

            formSections.forEach(section => {
                let sectionHasContent = false;
                const sectionRows: any[][] = [];

                section.fields.forEach(field => {
                    if (field.type === 'file') return;
                    if (field.containerId) {
                        const container = document.getElementById(field.containerId);
                        if (!container || container.style.display === 'none') return;
                    }

                    const value = formData[field.id];
                    let displayValue: string | null = null;
                    
                    if (field.type === 'clearance-group' && field.options) {
                        field.options.forEach(opt => {
                            const valueId = `${field.id}-${opt.value}-value`;
                            const unitId = `${field.id}-${opt.value}-units`;
                            if (formData[valueId]) {
                                sectionRows.push([opt.text, `${formData[valueId]} ${formData[unitId]}`]);
                                sectionHasContent = true;
                            }
                        });
                        return;
                    }

                    if (field.id === 'expansion-feature') {
                        const featureData = value;
                        if (typeof featureData === 'object' && featureData !== null && Object.keys(featureData).length > 0) {
                            displayValue = Object.entries(featureData).map(([val, count]) => {
                                const optionText = field.checkboxOptions?.find(opt => opt.value === val)?.text || val;
                                return `${optionText} (Qty: ${count})`;
                            }).join('\n');
                        }
                    } else if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0) ) {
                        const rawValueString = Array.isArray(value) ? value.join(', ') : String(value);
                        if (field.type === 'select') {
                           if (field.id === 'system-select') {
                                const docValue = formData['doc-select'] as keyof typeof systemData;
                                const systemList = systemData[docValue] || [];
                                const selectedSystem = systemList.find(opt => opt.value === rawValueString);
                                displayValue = selectedSystem ? selectedSystem.text : rawValueString.split('|')[0];
                           } else {
                                const selectedOption = field.options?.find(opt => opt.value === rawValueString);
                                displayValue = selectedOption ? selectedOption.text : rawValueString;
                            }
                        } else {
                            displayValue = rawValueString;
                        }
                    }
                    
                    if (displayValue !== null) {
                        sectionRows.push([field.label, displayValue]);
                        sectionHasContent = true;
                    }
                    
                    if(field.assessmentOptions) {
                        const assessmentKey = `${field.id}-assessment`;
                        const assessmentValue = formData[assessmentKey];
                        if (assessmentValue) {
                            sectionRows.push([`${field.label} (Source)`, assessmentValue]);
                            sectionHasContent = true;
                        }
                    }
                });
                
                if(sectionHasContent) {
                    reportData.push([{ content: section.title, styles: { fontStyle: 'bold', halign: 'left' } }]);
                    reportData.push(...sectionRows.map(row => [row[0].replace(/^  /, ''), row[1]]));
                }
            });

            (doc as any).autoTable({
                startY: margin,
                head: [['Field', 'Value']],
                body: reportData,
                theme: 'grid',
                headStyles: { fillColor: [0, 90, 156] },
                columnStyles: { 0: { halign: 'left' } },
                didParseCell: (data: any) => {
                    if (data.row.raw.length === 1) {
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = '#eef1f5';
                        data.cell.styles.textColor = '#003366';
                        data.cell.colSpan = 2;
                        data.cell.styles.halign = 'left';

                        const currentTitle = data.cell.text[0];
                        if (!tocEntries.some(e => e.title === currentTitle)) {
                            tocEntries.push({
                                title: currentTitle,
                                page: doc.internal.getCurrentPageInfo().pageNumber,
                                summary: sectionSummaries[currentTitle] || ''
                            });
                        }
                    }
                }
            });
            
            doc.setFont('helvetica', 'normal');

            // --- Photographs Page(s) ---
            const imageFiles = [...(fileDataStore['photographs'] || []), ...(fileDataStore['other-docs'] || [])]
                .filter(file => file && (file.type === 'image/jpeg' || file.type === 'image/png'));
            
            if (imageFiles.length > 0) {
                doc.addPage();
                const photosStartPage = doc.internal.getCurrentPageInfo().pageNumber;
                tocEntries.push({ title: 'Photographs and Attachments', page: photosStartPage});
                let photoY = margin;

                doc.setFontSize(16);
                doc.setFont('helvetica', 'bold');
                doc.text('Photographs and Attachments', margin, photoY);
                photoY += 10;
                
                imageFiles.forEach((file) => {
                    const imgWidth = 120;
                    const imgHeight = (imgWidth / 4) * 3;
                    const spacing = 10;
                    let commentHeight = 0;

                    if (file.comment) {
                        doc.setFontSize(9);
                        doc.setFont('helvetica', 'italic');
                        const commentLines = doc.splitTextToSize(file.comment, imgWidth);
                        commentHeight = (commentLines.length * 4) + 2;
                    }

                    if (photoY + imgHeight + commentHeight + spacing > pageHeight - margin) {
                        doc.addPage();
                        photoY = margin;
                    }
                    
                    doc.addImage(file.dataUrl, file.type.split('/')[1].toUpperCase(), margin, photoY, imgWidth, imgHeight);
                    
                    if (file.comment) {
                        doc.setFont('helvetica', 'italic');
                        const commentLines = doc.splitTextToSize(file.comment, imgWidth);
                        doc.text(commentLines, margin, photoY + imgHeight + 4);
                        doc.setFont('helvetica', 'normal');
                    }
                    
                    photoY += imgHeight + commentHeight + spacing;
                });
            }
            
            // --- Go back and write the Table of Contents on page 2 ---
            doc.setPage(2);
            let tocY = margin;
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Table of Contents', margin, tocY);
            tocY += 15;
            
            tocEntries.forEach(entry => {
                doc.setFontSize(12);
                doc.setFont('helvetica', 'normal');
                const dots = ".".repeat(Math.max(0, 100 - entry.title.length));
                doc.text(`${entry.title} ${dots} ${entry.page}`, margin, tocY);
                tocY += 6;

                if (entry.summary) {
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'italic');
                    const summaryLines = doc.splitTextToSize(entry.summary, pageWidth - margin * 2 - 5);
                    doc.text(summaryLines, margin + 5, tocY);
                    tocY += (summaryLines.length * 3.5) + 4;
                }
            });

            addHeaderFooter();
            doc.deletePage(1); // Delete the original blank page 1
            if (doc.internal.getNumberOfPages() > 1 && tocEntries.length > 0) {
                 doc.deletePage(1); // Delete the original title page, now we will re-insert it
            }
            const tempDoc = new jsPDF();
            tempDoc.addPage();
            tempDoc.deletePage(2);
            // Rebuild title page
            cursorY = margin;
            tempDoc.setFontSize(22);
            tempDoc.setFont('helvetica', 'bold');
            tempDoc.text('UNITIL Pipeline Bridge Crossing Assessment Report', pageWidth / 2, cursorY, { align: 'center' });
            cursorY += 20;
            tempDoc.setFontSize(12);
            tempDoc.setFont('helvetica', 'normal');
            tempDoc.text(`Crossing ID: ${formData['crossing-id'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            tempDoc.text(`Bridge Name: ${formData['bridge-name'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            tempDoc.text(`Town/City: ${formData['town-city'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            tempDoc.text(`District Operating Center: ${docText}`, margin, cursorY);
            cursorY += 7;
            tempDoc.text(`Date of Assessment: ${formData['date-of-assessment'] || 'N/A'}`, margin, cursorY);
            cursorY += 7;
            tempDoc.text(`Assessed By: ${formData['assessment-by'] || 'N/A'}`, margin, cursorY);
            cursorY += 15;
            tempDoc.setFontSize(16);
            tempDoc.setFont('helvetica', 'bold');
            tempDoc.text('Executive Summary', margin, cursorY);
            cursorY += 8;
            tempDoc.setFontSize(11);
            tempDoc.setFont('helvetica', 'normal');
            const finalSummaryLines = tempDoc.splitTextToSize(execSummary, pageWidth - margin * 2);
            tempDoc.text(finalSummaryLines, margin, cursorY);
            
            // This is a workaround to insert pages at the beginning
            const pageCount = doc.internal.getNumberOfPages();
            for(let i = pageCount; i >= 1; i--) {
                const pageData = doc.internal.pages[i];
                tempDoc.addPage(pageData.width, pageData.height);
                const newPage = tempDoc.internal.pages[tempDoc.internal.getNumberOfPages()];
                // Manually copy page content
                newPage.forEach(op => tempDoc.internal.write(op));
            }
            tempDoc.deletePage(1); // Delete blank page

            addHeaderFooter.call({internal: tempDoc.internal}); // Call addHeaderFooter in the context of the new doc

            const date = new Date().toISOString().split('T')[0];
            tempDoc.save(`pipeline-assessment-report-${formData['crossing-id'] || 'untitled'}-${date}.pdf`);

        } catch (error) {
            console.error("Failed to generate report:", error);
            alert("An unexpected error occurred while generating the PDF. Please check the console for details.");
        } finally {
            loadingOverlay.style.display = 'none';
        }
    }


    function handleExampleAssessment() {
        const exampleData = {
            "date-of-assessment": new Date().toISOString().substring(0, 10),
            "assessment-by": "Dana Argo",
            "doc-select": "nu-nh",
            "crossing-id": "Ocean Road Bridge",
            "town-city": "Hampton, NH",
            "crossing-description": "Pipeline is attached to the west side of the Ocean Road bridge, crossing the Hampton River.",
            "gps-lat": "42.9115° N",
            "gps-lon": "70.8123° W",
            "road-name": "Ocean Road",
            "feature-crossed": "Hampton River",
            "bridge-name": "Ocean Road Bridge",
            "bridge-number": "B-12-005",
            "bridge-type": "girder",
            "bridge-material": "steel",
            "ambient-temp": "68",
            "weather-conditions": "Clear and sunny, light breeze from the west.",
            "vegetation-growth": "Minor grass and weeds observed at the north abutment, well clear of supports.",
            "scour-erosion": "No significant scour was observed. Riverbed appears stable around piers.",
            "proximity-water": "Pipeline is approximately 20 feet above the mean high water mark.",
            "debris-accumulation": "No debris was found on or around pipeline supports.",
            "system-select": "Hampton IP|45 PSIG",
            "maop": "45 PSIG",
            "pipe-diameter": "8",
            "wall-thickness": "0.322",
            "wall-thickness-assessment": "Obtained from records",
            "wall-thickness-comments": "Wall thickness confirmed from original construction drawings dated 1982.",
            "pipe-material": "steel",
            "pipe-grade": "x52",
            "plastic-pipe-grade": "",
            "pipe-sdr": "",
            "installation-temp": "60",
            "installation-temp-assessment": "Assumed",
            "support-method": "hangers",
            "other-support-specify": "",
            "support-condition-thermal-stress-comments": "No signs of thermal stress. Hangers appear to be in good condition.",
            "pipe-movement-at-supports-comments": "Pipe appears to be adequately supported with no undue restrictions.",
            "sliding-roller-functionality-comments": "N/A",
            "support-comments": "All U-bolts and fasteners are tight. No significant corrosion noted on supports.",
            "expansion-feature": { "pipe_flexibility": 1 },
            "other-expansion-specify": "",
            "expansion-feature-functionality-comments": "The long, sweeping bend on the north approach appears to be providing adequate thermal expansion capability.",
            "expansion-comments": "Overall accommodation for thermal movement is satisfactory.",
            "coating-type": "fusion-bonded-epoxy",
            "other-coating-type-specify": "",
            "coating-comments": "Coating is in excellent condition. No holidays or damage found during visual inspection.",
            "pipe-physical-damage": "No physical damage was observed on the pipeline.",
            "atmospheric-corrosion-details": "No atmospheric corrosion was observed.",
            "clearance-group-v-hwy-value": "18.5",
            "clearance-group-v-hwy-units": "ft",
            "clearance-group-h-hwy-value": "12",
            "clearance-group-h-hwy-units": "ft",
            "clearance-group-v-water-value": "22",
            "clearance-group-v-water-units": "ft",
            "clearance-group-h-abutment-value": "60",
            "clearance-group-h-abutment-units": "in",
            "clearance-comments": "All clearances meet or exceed requirements.",
            "safety-hazards": "Moderate vehicle traffic on the bridge deck. No fall protection railings on the west side where the pipe is located.",
            "access-structures-condition": "N/A - no permanent access structures.",
            "access-safety-comments": "Access requires lane closure and fall protection equipment.",
            "other-utilities-bridge": "A conduit for telecommunications is also attached to the west side, approximately 3 feet below the gas line.",
            "bridge-structure-condition": "The bridge structure appears to be in good condition with no major spalling or rust noted.",
            "third-party-damage-potential": "Low potential for third-party damage due to pipeline elevation.",
            "third-party-comments": "Telecom conduit is well-secured.",
            "immediate-hazards": "None identified.",
            "actions-taken-hazards": "N/A",
            "recommendation-priority": "low",
            "recommendations-summary": "Recommend standard monitoring per inspection schedule. No immediate actions required.",
            "final-summary-evaluation": "The pipeline at this crossing is in excellent condition with no immediate concerns. The support system, coating, and cathodic protection are all functioning as intended. The primary recommendation is to continue routine inspections.",
            "fileData": {
                "photographs": [
                    { "name": "Upstream_View.jpg", "comment": "Photo taken from the north bank looking downstream.", "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "type": "image/jpeg" },
                    { "name": "Support_Hanger_3.jpg", "comment": "Close-up of the third support hanger from the east abutment.", "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "type": "image/jpeg" }
                ],
                "other-docs": [
                    { "name": "Installation_Sketch_1982.png", "comment": "Original installation sketch.", "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "type": "image/png" }
                ]
            }
        };
        populateFormWithData(exampleData);
    }
    
    function handleAdminUnlock() {
        const password = adminPasswordInput.value;
        if (password === "0665") {
            document.body.classList.add('voice-enabled');
            const successMessage = document.createElement('span');
            successMessage.className = 'unlocked-message';
            successMessage.textContent = 'Admin Features Unlocked';
            adminUnlockContainer.innerHTML = '';
            adminUnlockContainer.appendChild(successMessage);
        } else {
            adminPasswordInput.style.borderColor = 'red';
            adminPasswordInput.value = '';
            adminPasswordInput.placeholder = 'Incorrect';
            setTimeout(() => {
                adminPasswordInput.style.borderColor = '';
                adminPasswordInput.placeholder = 'Code';
            }, 2000);
        }
    }


    // --- Event Listeners ---
    saveButton.addEventListener('click', handleSaveAssessment);
    openButton.addEventListener('click', handleOpenAssessment);
    openFileInput.addEventListener('change', loadAssessmentFile);
    generateReportButton.addEventListener('click', handleGenerateReport);
    exampleButton.addEventListener('click', handleExampleAssessment);
    
    apiKeyInput.addEventListener('input', (e) => saveApiKey((e.target as HTMLInputElement).value));
    apiKeyToggle.addEventListener('click', () => {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
        apiKeyToggle.textContent = isPassword ? 'Hide' : 'Show';
    });

    adminUnlockButton.addEventListener('click', handleAdminUnlock);
    adminPasswordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleAdminUnlock();
        }
    });

    tabForm.addEventListener('click', () => {
        tabForm.classList.add('active');
        tabProcess.classList.remove('active');
        tabForm.setAttribute('aria-selected', 'true');
        tabProcess.setAttribute('aria-selected', 'false');
        formContainer.style.display = 'block';
        processContainer.style.display = 'none';
    });
    tabProcess.addEventListener('click', () => {
        tabProcess.classList.add('active');
        tabForm.classList.remove('active');
        tabProcess.setAttribute('aria-selected', 'true');
        tabForm.setAttribute('aria-selected', 'false');
        processContainer.style.display = 'block';
        formContainer.style.display = 'none';
    });

    // --- Initial Population ---
    populateForm();
    populateProcessGuidelines();
    const savedApiKey = loadApiKey();
    if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
    }
    handleDocChange(); // Initial call to set up the system select container correctly
    handlePipeMaterialChange(); // Initial call to set up conditional pipe fields
});