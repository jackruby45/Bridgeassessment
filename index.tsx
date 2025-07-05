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

interface ExpansionLoopData {
    leg1: string;
    leg2: string;
    leg3: string;
    source: string;
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

            // Add remove button
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.innerHTML = '&times;'; // '×' symbol
            removeButton.className = 'remove-file-button';
            removeButton.setAttribute('aria-label', `Remove ${fileInfo.name}`);
            removeButton.onclick = () => {
                if (fileDataStore[inputId]) {
                    fileDataStore[inputId].splice(index, 1);
                    renderFileList(inputId); // Re-render the list
                }
            };
            listItem.appendChild(removeButton);

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
            const ai = new GoogleGenAI({apiKey: process.env.Gemini_API_Key});
            const prompt = `Rewrite the following text for a professional engineering field report. Your response must be in a JSON array format containing 3 distinct alternative versions, like ["suggestion 1", "suggestion 2", "suggestion 3"]. For each suggestion, use well-structured paragraphs and professional, formal language appropriate for an engineering document. Improve clarity, grammar, and sentence structure, while preserving all original facts and the core meaning. Do not add any new information. Original text: "${originalText}"`;
            
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


function addExpansionLoopFieldset(container: HTMLElement, index: number) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'expansion-loop-entry';
    fieldset.dataset.index = String(index);

    const legend = document.createElement('legend');
    legend.textContent = `Expansion Loop #${index + 1}`;
    fieldset.appendChild(legend);
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '&times;';
    removeBtn.className = 'remove-loop-button';
    removeBtn.setAttribute('aria-label', `Remove Expansion Loop #${index + 1}`);
    removeBtn.onclick = () => fieldset.remove();
    fieldset.appendChild(removeBtn);

    const dimensionFields = [
        { id: `expansion-loop-leg1-${index}`, name: `expansion-loop-leg1-${index}`, label: 'Leg 1 Dimension (center-to-center, ft):' },
        { id: `expansion-loop-leg2-${index}`, name: `expansion-loop-leg2-${index}`, label: 'Leg 2 Dimension (center-to-center, ft):' },
        { id: `expansion-loop-leg3-${index}`, name: `expansion-loop-leg3-${index}`, label: 'Leg 3 Dimension (center-to-center, ft):' }
    ];

    dimensionFields.forEach(df => {
        const fieldWrapper = document.createElement('div');
        fieldWrapper.className = 'form-field-inline';
        const dimLabel = document.createElement('label');
        dimLabel.htmlFor = df.id;
        dimLabel.textContent = df.label;
        const dimInput = document.createElement('input');
        dimInput.type = 'number';
        dimInput.id = df.id;
        dimInput.name = df.name;
        dimInput.placeholder = 'feet';
        fieldWrapper.appendChild(dimLabel);
        fieldWrapper.appendChild(dimInput);
        fieldset.appendChild(fieldWrapper);
    });

    const sourceFieldset = document.createElement('fieldset');
    sourceFieldset.className = 'assessment-options-group';
    const sourceLegend = document.createElement('legend');
    sourceLegend.textContent = 'Dimension Source';
    sourceFieldset.appendChild(sourceLegend);

    const sourceOptions = ['Measured', 'Assumed', 'Obtained from records', 'Other'];
    sourceOptions.forEach((sOpt, radioIndex) => {
        const radioItem = document.createElement('div');
        radioItem.className = 'radio-item-inline';
        const radioInput = document.createElement('input');
        radioInput.type = 'radio';
        const radioId = `expansion-loop-source-${index}-${radioIndex}`;
        radioInput.id = radioId;
        radioInput.name = `expansion-loop-dimension-source-${index}`;
        radioInput.value = sOpt;
        const radioLabel = document.createElement('label');
        radioLabel.htmlFor = radioId;
        radioLabel.textContent = sOpt;
        radioItem.appendChild(radioInput);
        radioItem.appendChild(radioLabel);
        sourceFieldset.appendChild(radioItem);
    });
    fieldset.appendChild(sourceFieldset);

    container.appendChild(fieldset);
}

function handleAbutmentAChange(event: Event) {
    const abutmentASelect = event.target as HTMLSelectElement;
    const abutmentBSelect = document.getElementById('abutment-b-location') as HTMLSelectElement;
    if (!abutmentBSelect) return;

    const selectedValue = abutmentASelect.value;
    let oppositeValue = '';

    switch (selectedValue) {
        case 'north':
            oppositeValue = 'south';
            break;
        case 'south':
            oppositeValue = 'north';
            break;
        case 'east':
            oppositeValue = 'west';
            break;
        case 'west':
            oppositeValue = 'east';
            break;
        default:
            oppositeValue = ''; // Handle the "Select Direction..." case
    }
    
    abutmentBSelect.value = oppositeValue;
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

                // --- Special handling for expansion features ---
                if (field.id === 'expansion-feature') {
                    if (opt.value === 'expansion_loop') {
                        const detailsContainer = document.createElement('div');
                        detailsContainer.id = 'expansion-loop-details-container';
                        detailsContainer.className = 'expansion-loop-details';
                        detailsContainer.style.display = 'none'; // Initially hidden

                        const loopList = document.createElement('div');
                        loopList.id = 'expansion-loop-list';
                        detailsContainer.appendChild(loopList);

                        const addButtonContainer = document.createElement('div');
                        addButtonContainer.className = 'add-loop-button-container';
                        const addButton = document.createElement('button');
                        addButton.id = 'add-expansion-loop-button';
                        addButton.type = 'button';
                        addButton.textContent = '+ Add Expansion Loop';
                        addButton.className = 'control-button';
                        addButtonContainer.appendChild(addButton);
                        detailsContainer.appendChild(addButtonContainer);

                        itemContainer.appendChild(detailsContainer);

                        input.addEventListener('change', () => {
                            if (input.checked) {
                                detailsContainer.style.display = 'block';
                            } else {
                                detailsContainer.style.display = 'none';
                                loopList.innerHTML = ''; // Clear added loops when unchecked
                            }
                        });
                    } else {
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
                }
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
    }

    // This block is now generalized to apply to any field with assessmentOptions
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

// Reusable options for support methods
const supportMethodOptions = [
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
];

// Reusable options for cardinal directions
const directionOptions = [
    { value: "", text: "Select Direction..." },
    { value: "north", text: "North" },
    { value: "south", text: "South" },
    { value: "east", text: "East" },
    { value: "west", text: "West" }
];

// Reusable options for support distance source
const supportDistanceSourceOptions = ["Estimated", "Measured", "Obtained from installation records"];


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
            {
                label: "Pipe Diameter (inches):",
                id: "pipe-diameter",
                type: "select",
                options: [
                    { value: "", text: "Select Diameter..." },
                    { value: "2", text: "2\"" },
                    { value: "3", text: "3\"" },
                    { value: "4", text: "4\"" },
                    { value: "6", text: "6\"" },
                    { value: "8", text: "8\"" },
                    { value: "10", text: "10\"" },
                    { value: "12", text: "12\"" }
                ]
            },
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
                ],
                assessmentOptions: ["From records", "Stamped on pipe", "Assumed", "Unknown"],
                defaultAssessmentOption: "Unknown"
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
                label: "Abutment A Location (Left):",
                id: "abutment-a-location",
                type: "select",
                options: directionOptions
            },
            {
                label: "Abutment B Location (Right):",
                id: "abutment-b-location",
                type: "select",
                options: directionOptions
            },
            {
                label: "Primary Support Method:",
                id: "support-method",
                type: "select",
                options: supportMethodOptions
            },
            {
                label: "Number of Supports:",
                id: "primary-support-count",
                type: "number",
                placeholder: "e.g., 10"
            },
            {
                label: "Distance to nearest support to the left (ft):",
                id: "primary-support-dist-left",
                type: "number",
                placeholder: "feet",
                assessmentOptions: supportDistanceSourceOptions,
                defaultAssessmentOption: "Estimated"
            },
            {
                label: "Distance to nearest support to the right (ft):",
                id: "primary-support-dist-right",
                type: "number",
                placeholder: "feet",
                assessmentOptions: supportDistanceSourceOptions,
                defaultAssessmentOption: "Estimated"
            },
            {
                label: "Secondary Support Method:",
                id: "secondary-support-method",
                type: "select",
                options: supportMethodOptions
            },
            {
                label: "Number of Supports:",
                id: "secondary-support-count",
                type: "number",
                placeholder: "e.g., 4"
            },
            {
                label: "Distance to nearest support to the left (ft):",
                id: "secondary-support-dist-left",
                type: "number",
                placeholder: "feet",
                assessmentOptions: supportDistanceSourceOptions,
                defaultAssessmentOption: "Estimated"
            },
            {
                label: "Distance to nearest support to the right (ft):",
                id: "secondary-support-dist-right",
                type: "number",
                placeholder: "feet",
                assessmentOptions: supportDistanceSourceOptions,
                defaultAssessmentOption: "Estimated"
            },
            {
                label: "Tertiary Support Method:",
                id: "tertiary-support-method",
                type: "select",
                options: supportMethodOptions
            },
            {
                label: "Number of Supports:",
                id: "tertiary-support-count",
                type: "number",
                placeholder: "e.g., 2"
            },
            {
                label: "Distance to nearest support to the left (ft):",
                id: "tertiary-support-dist-left",
                type: "number",
                placeholder: "feet",
                assessmentOptions: supportDistanceSourceOptions,
                defaultAssessmentOption: "Estimated"
            },
            {
                label: "Distance to nearest support to the right (ft):",
                id: "tertiary-support-dist-right",
                type: "number",
                placeholder: "feet",
                assessmentOptions: supportDistanceSourceOptions,
                defaultAssessmentOption: "Estimated"
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
                    if (input.value === 'expansion_loop') {
                        featureData[input.value] = 1;
                    } else {
                        const quantityInput = document.getElementById(`${input.id}-quantity`) as HTMLInputElement;
                        if (quantityInput && quantityInput.value) {
                            const quantity = parseInt(quantityInput.value, 10);
                            if (!isNaN(quantity) && quantity > 0) {
                                featureData[input.value] = quantity;
                            }
                        } else {
                             featureData[input.value] = 1;
                        }
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

    // Get expansion loop details if checked
    const expansionLoopCheckbox = document.getElementById('expansion-feature-expansion_loop') as HTMLInputElement;
    if (expansionLoopCheckbox?.checked) {
        const loops: ExpansionLoopData[] = [];
        const loopEntries = document.querySelectorAll<HTMLFieldSetElement>('.expansion-loop-entry');
        loopEntries.forEach((fieldset, index) => {
            const leg1 = (document.getElementById(`expansion-loop-leg1-${index}`) as HTMLInputElement)?.value || '';
            const leg2 = (document.getElementById(`expansion-loop-leg2-${index}`) as HTMLInputElement)?.value || '';
            const leg3 = (document.getElementById(`expansion-loop-leg3-${index}`) as HTMLInputElement)?.value || '';
            const sourceRadio = form.querySelector<HTMLInputElement>(`input[name="expansion-loop-dimension-source-${index}"]:checked`);
            const source = sourceRadio ? sourceRadio.value : '';
            loops.push({ leg1, leg2, leg3, source });
        });
        data.expansion_loops = loops;
    }

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
    const adminLockButton = document.getElementById('admin-lock-button') as HTMLButtonElement;
    const adminLockedView = document.getElementById('admin-locked-view') as HTMLElement;
    const adminUnlockedView = document.getElementById('admin-unlocked-view') as HTMLElement;


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

        const abutmentASelect = document.getElementById('abutment-a-location') as HTMLSelectElement;
        if (abutmentASelect) {
            abutmentASelect.addEventListener('change', handleAbutmentAChange);
        }

        const addLoopButton = document.getElementById('add-expansion-loop-button');
        if (addLoopButton) {
            addLoopButton.addEventListener('click', () => {
                const loopList = document.getElementById('expansion-loop-list');
                if (loopList) {
                    const index = loopList.children.length;
                    addExpansionLoopFieldset(loopList, index);
                }
            });
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
            <p>This document establishes the standard for completing the Pipeline Bridge Crossing Assessment Form. The objective is to ensure a consistent, thorough, and safe evaluation of all pipeline assets at bridge crossings. Adherence to these guidelines is mandatory for ensuring data quality and the integrity of the assessment program.</p>

            <h3>General Principles</h3>
            <ul>
                <li><strong>Safety:</strong> Prioritize personal and public safety at all times. Conduct a pre-work hazard assessment, evaluating traffic, fall protection requirements, and environmental conditions. Utilize all required Personal Protective Equipment (PPE).</li>
                <li><strong>Accuracy:</strong> All data entered must be as accurate as possible. Differentiate between measured values, information from records, and estimations, using the provided options for each field.</li>
                <li><strong>Completeness:</strong> Complete all applicable sections. Use comment fields to provide detailed explanations, especially for deficiencies, abnormal conditions, or to add context to a selection.</li>
                <li><strong>Documentation:</strong> Photographic evidence is a critical component of the assessment. Capture high-quality images of all key components and any areas of concern.</li>
            </ul>

            <h3>Field-by-Field Instructions</h3>
            
            <h4>1. General Site & Crossing Information</h4>
            <p>This section captures the administrative and locational data for the assessment.</p>
            <ul>
                <li><strong>Date of Assessment:</strong> Enter the date on which the physical site inspection is performed.</li>
                <li><strong>Assessment By:</strong> Record the full name(s) of the individual(s) conducting the assessment.</li>
                <li><strong>District Operating Center (DOC):</strong> Select the correct operating company. This selection dictates the available systems in Section 3.</li>
                <li><strong>Crossing Identification Number:</strong> Enter the official company-assigned identifier for the crossing (e.g., BR-123). If none exists, use a descriptive name (e.g., "Main St over Saco River").</li>
                <li><strong>Town/City:</strong> Enter the municipality where the crossing is located.</li>
                <li><strong>Description of Crossing/Work Location:</strong> Provide a concise but detailed text description, sufficient for an unfamiliar person to locate the asset. Include details like "pipeline on west side of bridge" or "access from north abutment".</li>
                <li><strong>GPS Latitude / Longitude:</strong> Use a GPS device to capture the coordinates at the approximate midpoint of the pipeline crossing. Use decimal degrees format.</li>
            </ul>

            <h4>2. Bridge & Environmental Context</h4>
            <p>This section documents the host structure and surrounding environment, which directly impact the pipeline's condition and performance.</p>
            <ul>
                <li><strong>Road Name:</strong> The name of the road carried by the bridge.</li>
                <li><strong>Feature Crossed:</strong> The river, highway, railway, or other feature the bridge spans.</li>
                <li><strong>Bridge Name / Number:</strong> Enter the official bridge name and/or number, typically found on a plaque on the bridge abutment.</li>
                <li><strong>Bridge Type / Material:</strong> Select the best-fit options from the dropdowns. This information provides context on the bridge's expected movement and potential interaction with the pipeline.</li>
                <li><strong>Ambient Temperature:</strong> Record the air temperature in degrees Fahrenheit (°F) at the time of the inspection. This is a critical data point for thermal stress analysis.</li>
                <li><strong>General Weather Conditions:</strong> Describe the weather (e.g., "Sunny, 10-15 mph wind," "Overcast, light rain").</li>
                <li><strong>Vegetation Growth:</strong> Describe any vegetation impacting or potentially impacting the pipeline, supports, or access. Note any root systems undermining supports.</li>
                <li><strong>Evidence of Scour or Erosion:</strong> Inspect the ground around abutments and piers. Document any signs of soil being washed away, which could compromise support structures.</li>
                <li><strong>Proximity to Water Body/Wetlands:</strong> Describe the pipeline's relationship to any water, noting if it is directly over water and its approximate height.</li>
                <li><strong>Signs of Debris Accumulation:</strong> Note any buildup of logs, ice, trash, or other debris against the pipeline or its supports, as this can create unintended loads.</li>
            </ul>

            <h4>3. Pipeline Identification & Specifications</h4>
            <p>This section details the physical and operational parameters of the pipeline itself.</p>
            <ul>
                <li><strong>System Name & MAOP:</strong> After selecting a DOC, choose the correct system. The MAOP (Maximum Allowable Operating Pressure) will auto-populate.</li>
                <li><strong>Pipe Diameter:</strong> Select the nominal pipe diameter in inches.</li>
                <li><strong>Wall Thickness (inches):</strong> Enter the pipe wall thickness. Crucially, select the source of this information (e.g., Measured, from records, Assumed).</li>
                <li><strong>Comments on Wall Thickness:</strong> Use this field to add context, e.g., "Thickness measured with UT gauge at north end" or "Assumed based on standard for this vintage."</li>
                <li><strong>Pipe Material:</strong> Select the material. This choice will display or hide the relevant fields below (Grade for steel, SDR for plastic).</li>
                <li><strong>Pipe Grade (Steel):</strong> If steel, select the pipe grade (e.g., X52). Select the source of this information (e.g., Stamped on pipe, from records).</li>
                <li><strong>Pipe Grade (Plastic) & SDR:</strong> If plastic, select the material grade and enter the Standard Dimension Ratio (e.g., 11, 13.5).</li>
                <li><strong>Installation Temperature (°F):</strong> Enter the temperature at which the pipe was installed. This is a key input for engineering analysis. Select the source, noting whether it is documented or assumed.</li>
            </ul>
            
            <h4>4. Pipeline Support System</h4>
            <p>This section evaluates the structural system holding the pipeline.</p>
            <ul>
                <li><strong>Abutment A/B Location:</strong> Define the crossing's orientation. Standing at one end (Abutment A) and looking across to the other (Abutment B), determine the cardinal directions. Abutment A is the "(Left)" and B is the "(Right)" from this perspective. The form will auto-populate the opposite direction.</li>
                <li><strong>Primary/Secondary/Tertiary Support Method:</strong> Identify all distinct support systems. The most common is Primary. Use Secondary and Tertiary for any additional, different types of supports present.</li>
                <li><strong>Number of Supports:</strong> For each support method identified, enter the total count of that support type.</li>
                <li><strong>Distance to nearest support (Left/Right):</strong> For a typical support within each group (Primary, Secondary, Tertiary), measure or estimate the span distance to the next support on its left and its right. Select how this value was determined (Estimated, Measured, etc.).</li>
                <li><strong>Specify Other Support Method:</strong> If "Other" is selected in any support method dropdown, describe it here.</li>
                <li><strong>Comments on Support Condition (Thermal Stress):</strong> Look for signs of stress, such as bent hanger rods, deformed brackets, or pipe lifting off a support saddle.</li>
                <li><strong>Comments on Pipe Movement/Restriction:</strong> Assess if the pipe is being pinched, gripped, or otherwise prevented from moving as intended by the support design.</li>
                <li><strong>Comments on Sliding/Roller Support Functionality:</strong> If rollers or sliding plates are present, check for seizure, debris, or lack of lubrication that would impede movement.</li>
                <li><strong>Comments on Pipeline Support & Attachment (General):</strong> Provide a general summary of the support system's condition, noting loose fasteners, general corrosion, or other concerns.</li>
            </ul>
            
            <h4>5. Expansion/Contraction Provisions</h4>
            <p>This section assesses features designed to manage pipeline movement from temperature changes.</p>
            <ul>
                <li><strong>Expansion/Contraction Features:</strong> Check all features present. For items like joints or couplings, enter the quantity in the small box that appears.</li>
                <li><strong>Expansion Loop Details:</strong> If "Expansion Loop" is checked, click "+ Add Expansion Loop" for each loop. For each, enter the three leg dimensions (center-of-fitting to center-of-fitting) in feet. Select the source for these dimensions.</li>
                <li><strong>Specify Other Expansion Feature:</strong> If "Other" is checked, provide a description here.</li>
                <li><strong>Comments on Expansion Feature Functionality:</strong> Evaluate if the features are working. Is a loop clear of debris? Is a slip joint seized or leaking?</li>
                <li><strong>Comments on Expansion/Contraction Accommodation (General):</strong> Give an overall assessment of the system's ability to manage thermal movement.</li>
            </ul>

            <h4>6. Coating and Corrosion Control</h4>
            <p>This section examines the protective coating on the pipeline.</p>
            <ul>
                <li><strong>Coating Type:</strong> Select the identified coating type.</li>
                <li><strong>Specify Other Coating Type:</strong> If "Other" is selected, describe it here.</li>
                <li><strong>Comments on Coating:</strong> Meticulously describe the coating's condition. Document any and all instances of holidays, disbondment, peeling, cracking, or mechanical damage.</li>
            </ul>

            <h4>7. Pipe Condition Assessment</h4>
            <p>This section covers direct inspection of the pipe body itself.</p>
            <ul>
                <li><strong>Evidence of Physical Damage:</strong> Document any dents, gouges, scrapes, or other mechanical damage. Note the location, size, and estimated depth.</li>
                <li><strong>Atmospheric Corrosion:</strong> For any exposed steel, describe the extent and severity of corrosion. Classify it as Light (surface rust), Moderate (pitting beginning), or Severe (flaking, section loss).</li>
            </ul>
            
            <h4>8. Clearances and Measurements</h4>
            <p>This section verifies the pipeline's position relative to its surroundings.</p>
            <ul>
                <li><strong>Clearances:</strong> Measure and record the distances for all applicable clearances (e.g., vertical from roadway, vertical from high water mark). Enter the value and select the correct units (ft or in).</li>
                <li><strong>Comments on Clearances and Measurements:</strong> Note the required clearance vs. the actual measured clearance. Document any deficiencies.</li>
            </ul>

            <h4>9. Access and Safety</h4>
            <p>This section evaluates site safety for current and future work.</p>
            <ul>
                <li><strong>Safety Hazards Noted:</strong> Document any transient or permanent hazards, such as high-speed traffic, lack of fall protection, confined space entry requirements, or aggressive animals.</li>
                <li><strong>Condition of Access Structures:</strong> If permanent ladders, platforms, or walkways exist, describe their condition (e.g., "Ladder rungs heavily corroded," "Walkway grating secure").</li>
                <li><strong>Comments on Access & Safety:</strong> Provide a general summary of the effort and equipment required to safely access the pipeline for inspection and maintenance.</li>
            </ul>
            
            <h4>10. Documentation</h4>
            <p>This section is for uploading all collected visual evidence and records.</p>
            <ul>
                <li><strong>Upload Photographs/Sketches:</strong> Upload all digital photographs. It is critical to use the comment field for each photo to provide a descriptive caption (e.g., "View from North abutment looking South," "Close-up of corrosion at support H-3," "Sketch of dent measurement on top of pipe").</li>
                <li><strong>Upload Other Documents:</strong> Upload any supporting files, such as sketches, previous reports, or relevant pages from construction drawings.</li>
            </ul>

            <h4>11. Third-Party Infrastructure and General Observations</h4>
            <p>This section documents other factors that could influence the pipeline.</p>
            <ul>
                <li><strong>Other Utilities or Structures:</strong> Note any other assets attached to or near the bridge (e.g., "telecom conduit 2 ft below gas line," "water main on east side of bridge").</li>
                <li><strong>Observed Condition of Bridge Structure (General):</strong> Briefly note the general condition of the host bridge. Document any major, obvious defects like large concrete spalls, section loss on steel girders, or failing abutments.</li>
                <li><strong>Potential for Third-Party Damage:</strong> Assess and describe any potential for future damage from traffic, mowers, vandalism, or other external forces.</li>
                <li><strong>Comments on Third-Party Infrastructure:</strong> Provide any additional relevant comments.</li>
            </ul>
            
            <h4>12. Recommendations and Final Evaluation</h4>
            <p>This section synthesizes all findings into a conclusion and actionable plan.</p>
            <ul>
                <li><strong>Any Immediate Hazards Identified:</strong> Describe any condition that poses an immediate or near-term risk to the pipeline or public and requires urgent notification and action.</li>
                <li><strong>Actions Taken/Notification Made:</strong> If an immediate hazard was found, document precisely what actions were taken on-site and who was notified (e.g., "Contacted Gas Control supervisor John Smith at 14:30").</li>
                <li><strong>Recommendation Priority:</strong> Assign a priority level to the recommendations to guide scheduling of corrective actions.</li>
                <li><strong>Summary of Recommendations:</strong> List clear, concise, and actionable recommendations (e.g., "1. Repair coating at support H-5. 2. Remove vegetation from north abutment.").</li>
                <li><strong>Final Summary of Evaluation:</strong> Provide a high-level, professional summary of the crossing's overall condition, synthesizing the key findings from the entire assessment.</li>
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
            if (key === 'fileData' || key === 'expansion_loops') {
                // Handled separately below
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
                            if (checkbox) {
                                checkbox.checked = true;
                                
                                // Manually trigger change to show containers
                                checkbox.dispatchEvent(new Event('change'));

                                if (featureValue !== 'expansion_loop') {
                                    const quantityInput = document.getElementById(`${checkboxId}-quantity`) as HTMLInputElement;
                                    if (quantityInput) {
                                        quantityInput.value = String(quantity);
                                        quantityInput.style.display = 'inline-block';
                                    }
                                }
                            }
                        });
                    } else { // Fallback for old array format
                        const values = Array.isArray(data[key]) ? data[key] : [];
                        for (const el of Array.from(elementsByName) as HTMLInputElement[]) {
                           el.checked = values.includes(el.value);
                        }
                    }
                }
            }
        });
        
        // Populate file data
        if (data.fileData) {
            const loadedFileData = data.fileData;
            Object.keys(loadedFileData).forEach(inputId => {
                fileDataStore[inputId] = loadedFileData[inputId];
                renderFileList(inputId);
            });
        }
        
        // Populate expansion loops
        if (data.expansion_loops && Array.isArray(data.expansion_loops)) {
            const addLoopButton = document.getElementById('add-expansion-loop-button');
            if (addLoopButton) {
                data.expansion_loops.forEach((loopData: ExpansionLoopData, index: number) => {
                    addLoopButton.click(); // Creates a new fieldset
                    (document.getElementById(`expansion-loop-leg1-${index}`) as HTMLInputElement).value = loopData.leg1;
                    (document.getElementById(`expansion-loop-leg2-${index}`) as HTMLInputElement).value = loopData.leg2;
                    (document.getElementById(`expansion-loop-leg3-${index}`) as HTMLInputElement).value = loopData.leg3;
                    if (loopData.source) {
                        const sourceRadio = document.querySelector(`input[name="expansion-loop-dimension-source-${index}"][value="${loopData.source}"]`) as HTMLInputElement;
                        if (sourceRadio) sourceRadio.checked = true;
                    }
                });
            }
        }


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
                    const featureData = rawValue as { [key: string]: number };
                    if (typeof featureData === 'object' && featureData !== null && Object.keys(featureData).length > 0) {
                        displayValue = Object.entries(featureData).map(([value, count]) => {
                            const optionText = field.checkboxOptions?.find(opt => opt.value === value)?.text || value;
                             if (value !== 'expansion_loop' && count > 1) {
                                return `${optionText} (Qty: ${count})`;
                            }
                            return optionText;
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
                        } else if (field.id === 'support-method' || field.id === 'secondary-support-method' || field.id === 'tertiary-support-method') {
                            currentOptions = supportMethodOptions;
                        } else if (field.id === 'abutment-a-location' || field.id === 'abutment-b-location') {
                            currentOptions = directionOptions;
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

        // Add Expansion Loop details to summary
        if (formData.expansion_loops && formData.expansion_loops.length > 0) {
            summary += "\n--- Expansion Loop Details ---\n";
            formData.expansion_loops.forEach((loop: ExpansionLoopData, index: number) => {
                summary += `Loop #${index + 1}:\n`;
                if (loop.leg1) summary += `  - Leg 1: ${loop.leg1} ft\n`;
                if (loop.leg2) summary += `  - Leg 2: ${loop.leg2} ft\n`;
                if (loop.leg3) summary += `  - Leg 3: ${loop.leg3} ft\n`;
                if (loop.source) summary += `  - Dimension Source: ${loop.source}\n`;
            });
        }
        
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
        const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
        const loadingText = document.getElementById('loading-text') as HTMLElement;
        const modal = document.getElementById('summary-review-modal') as HTMLElement;
        const execSummaryTextarea = document.getElementById('modal-exec-summary') as HTMLTextAreaElement;
        const finalSummaryTextarea = document.getElementById('modal-final-summary') as HTMLTextAreaElement;
        
        const formData = getFormData();
        
        let execSummary = "Executive Summary requires admin features to be unlocked.";
        let finalSummary = "Final Summary requires admin features to be unlocked.";

        if (document.body.classList.contains('voice-enabled')) {
            loadingText.textContent = "Generating...";
            loadingOverlay.style.display = 'flex';

            const fullTextSummary = generateTextSummaryForAI(formData);

            // --- AI Generation ---
            const ai = new GoogleGenAI({ apiKey: process.env.Gemini_API_Key });

            const execSummaryPrompt = `Based on the following pipeline bridge crossing assessment data, write a detailed and comprehensive professional Executive Summary for an engineering report. Structure the summary with clear paragraphs and use formal, professional language. This summary should be thorough, elaborating on the overall condition, all findings from minor to high-priority, and the specific recommendations made. Ensure the summary is extensive enough to provide a full overview without being overly brief. Data:\n${fullTextSummary}`;
            const finalSummaryPrompt = `Based on the following pipeline bridge crossing assessment data, write a comprehensive "Final Summary of Evaluation". This should synthesize all key findings from the report into one or more detailed concluding paragraphs. Use formal, professional language and structure the response into well-formed paragraphs. Data:\n${fullTextSummary}`;
            
            try {
                const promises = [
                    ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: execSummaryPrompt }),
                    ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: finalSummaryPrompt }),
                ];

                const [execResult, finalResult] = await Promise.allSettled(promises);

                execSummary = (execResult.status === 'fulfilled') 
                    ? execResult.value.text 
                    : `Warning: Could not connect to the AI service to generate summary. Please check the console for details.`;
        
                finalSummary = (finalResult.status === 'fulfilled') 
                    ? finalResult.value.text 
                    : `Warning: Could not connect to the AI service to generate summary. Please check the console for details.`;
            } catch (error) {
                 console.error("Error generating report summaries:", error);
                 execSummary = "Error: Failed to generate executive summary.";
                 finalSummary = "Error: Failed to generate final summary.";
            } finally {
                loadingOverlay.style.display = 'none';
            }
        }

        // --- Populate Modal ---
        execSummaryTextarea.value = execSummary;
        finalSummaryTextarea.value = finalSummary;
            
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
            buildPdfDocument(formData, execSummaryTextarea.value, finalSummaryTextarea.value);
        };

        const cancelHandler = () => {
            modal.style.display = 'none';
        };
        
        newGenerateButton.addEventListener('click', generatePdfHandler);
        newCancelButton.addEventListener('click', cancelHandler);
    }
    
    interface TocEntry {
        uniqueId: string; // A unique identifier for the entry
        title: string;
        level: 0 | 1; // 0 for section, 1 for field
        tocPage: number; // The page number of the ToC page where this entry is
        y: number; // The y-coordinate on the ToC page
        contentPage?: number; // The page number of the content this entry points to
    }

    async function buildPdfDocument(formData: { [key: string]: any }, execSummary: string, finalSummary: string) {
        const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
        const loadingText = document.getElementById('loading-text') as HTMLElement;
        loadingText.textContent = "Generating PDF...";
        loadingOverlay.style.display = 'flex';
    
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
    
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 15;
            
            formData['final-summary-evaluation'] = finalSummary;
    
            // --- Helper for header/footer ---
            const addHeaderFooter = () => {
                const pageCount = doc.internal.getNumberOfPages();
                for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    // No header/footer on title page or any direct continuations of it
                    const isTitlePage = i === 1; 
                    // This logic is imperfect for multi-page summaries, but for now, we'll keep it simple
                    // and skip the first page. A more robust way would track summary pages.
                    if (isTitlePage) continue;
                    
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(9);
                    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
                    doc.text(`Crossing ID: ${formData['crossing-id'] || 'N/A'}`, margin, pageHeight - 10);
                }
            };
            
            // =================================================================
            // PAGE 1: TITLE PAGE & EXECUTIVE SUMMARY
            // =================================================================
            let cursorY = margin;
            doc.setFontSize(22);
            doc.setFont('helvetica', 'bold');
            doc.text('UNITIL Pipeline Bridge Crossing Assessment Report', pageWidth / 2, cursorY, { align: 'center' });
            cursorY += 20;
    
            const docField = formSections.find(s => s.id === 'general-info')?.fields.find(f => f.id === 'doc-select');
            const docValue = formData['doc-select'];
            const docText = docField?.options?.find(opt => opt.value === docValue)?.text || 'N/A';
    
            doc.setFontSize(12);
            doc.setFont('helvetica', 'normal');
            doc.text(`Crossing ID: ${formData['crossing-id'] || 'N/A'}`, margin, cursorY); cursorY += 7;
            doc.text(`Bridge Name: ${formData['bridge-name'] || 'N/A'}`, margin, cursorY); cursorY += 7;
            doc.text(`Town/City: ${formData['town-city'] || 'N/A'}`, margin, cursorY); cursorY += 7;
            doc.text(`District Operating Center: ${docText}`, margin, cursorY); cursorY += 7;
            doc.text(`Date of Assessment: ${formData['date-of-assessment'] || 'N/A'}`, margin, cursorY); cursorY += 7;
            doc.text(`Assessed By: ${formData['assessment-by'] || 'N/A'}`, margin, cursorY); cursorY += 15;
    
            // --- Executive Summary with Page Break Handling ---
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Executive Summary', margin, cursorY);
            cursorY += 8;

            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            const summaryLines = doc.splitTextToSize(execSummary, pageWidth - margin * 2);
            const lineHeight = doc.getFontSize(); // Use font size for true single spacing

            for (const line of summaryLines) {
                // Check if adding the next line would overflow the page
                if (cursorY + lineHeight > pageHeight - margin) {
                    doc.addPage();
                    cursorY = margin; // Reset cursor to top margin

                    // Add a continuation header on the new page
                    doc.setFontSize(16);
                    doc.setFont('helvetica', 'bold');
                    doc.text('Executive Summary (Continued)', margin, cursorY);
                    cursorY += 12; // Extra space after header
                    
                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'normal');
                }
                doc.text(line, margin, cursorY);
                cursorY += lineHeight; // Use single-spaced line height
            }
    
            // =================================================================
            // PASS 1: DRAW TABLE OF CONTENTS LAYOUT (without page numbers)
            // =================================================================
            doc.addPage();
            let tocPageNumber = doc.internal.getCurrentPageInfo().pageNumber;
            let tocY = margin;
            const tocEntries: TocEntry[] = [];
            
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Table of Contents', margin, tocY);
            tocY += 15;
    
            const allTocItems: { uniqueId: string, title: string; level: 0 | 1 }[] = [];
            formSections.forEach(section => {
                allTocItems.push({ uniqueId: section.id, title: section.title, level: 0 });
                section.fields.forEach(field => {
                    if (field.type === 'file' || (field.containerId && document.getElementById(field.containerId)?.style.display === 'none')) {
                        return;
                    }
                    if (field.type === 'clearance-group' && field.options) {
                        field.options.forEach(opt => {
                            allTocItems.push({ uniqueId: `${section.id}-${field.id}-${opt.value}`, title: opt.text, level: 1 });
                        });
                        return; // Done with this field, skip generic label addition
                    }
                    allTocItems.push({ uniqueId: `${section.id}-${field.id}`, title: field.label, level: 1 });
                    if (field.assessmentOptions) {
                        allTocItems.push({ uniqueId: `${section.id}-${field.id}-assessment`, title: `${field.label} (Source)`, level: 1 });
                    }
                });
            });
            
            // Add Expansion Loops to ToC
            if (formData.expansion_loops && formData.expansion_loops.length > 0) {
                 allTocItems.push({ uniqueId: 'expansion_loops_section', title: 'Expansion Loop Details', level: 0 });
                 formData.expansion_loops.forEach((loop: ExpansionLoopData, index: number) => {
                     allTocItems.push({ uniqueId: `expansion_loop_${index}`, title: `Expansion Loop #${index + 1}`, level: 1 });
                 });
            }

            const imageFiles = [...(fileDataStore['photographs'] || []), ...(fileDataStore['other-docs'] || [])]
                .filter(file => file && (file.type === 'image/jpeg' || file.type === 'image/png'));
            if (imageFiles.length > 0) {
                allTocItems.push({ uniqueId: 'photographs', title: 'Photographs and Attachments', level: 0 });
            }
    
            for (const item of allTocItems) {
                const isSection = item.level === 0;
                const requiredHeight = isSection ? 7 : 6;
                
                if (tocY + requiredHeight > pageHeight - margin) {
                    doc.addPage();
                    tocPageNumber = doc.internal.getCurrentPageInfo().pageNumber;
                    tocY = margin;
                    doc.setFontSize(16);
                    doc.setFont('helvetica', 'bold');
                    doc.text('Table of Contents (Continued)', margin, tocY);
                    tocY += 15;
                }
                
                doc.setTextColor(0, 0, 0);
                doc.setFontSize(isSection ? 12 : 10);
                doc.setFont('helvetica', isSection ? 'bold' : 'normal');
    
                const indent = isSection ? margin : margin + 5;
                const title = item.title;
                const pageNumPlaceholderWidth = doc.getTextWidth('999'); // Estimate width
    
                const leaderWidth = pageWidth - margin - pageNumPlaceholderWidth - 2;
                doc.text(title, indent, tocY);
                
                let titleWidth = doc.getTextWidth(title);
                let currentX = indent + titleWidth + 1;
                const dotWidth = doc.getTextWidth('.');
                while (currentX < leaderWidth) {
                    doc.text('.', currentX, tocY);
                    currentX += dotWidth;
                }
                
                tocEntries.push({ uniqueId: item.uniqueId, title: item.title, level: item.level, tocPage: tocPageNumber, y: tocY });
                tocY += requiredHeight;
            }
    
            // =================================================================
            // PASS 2: GENERATE CONTENT & GATHER PAGE NUMBERS
            // =================================================================
            doc.addPage();
            
            // Create a map for efficient lookups. Assumes uniqueIds are unique.
            const tocMap = new Map<string, TocEntry>();
            for (const entry of tocEntries) {
                tocMap.set(entry.uniqueId, entry);
            }

            const reportData: (string | { content: string; styles?: any; colSpan?: number })[][] = [];
            const reportDataIds: string[] = []; // Parallel array to hold unique IDs
            
            formSections.forEach(section => {
                reportData.push([{ content: section.title, colSpan: 2, styles: { fontStyle: 'bold', fillColor: '#eef1f5', textColor: '#003366', halign: 'left' } }]);
                reportDataIds.push(section.id);
                
                section.fields.forEach(field => {
                    if (field.type === 'file' || (field.containerId && document.getElementById(field.containerId)?.style.display === 'none')) return;
    
                    if (field.type === 'clearance-group' && field.options) {
                        field.options.forEach(opt => {
                            const valueId = `${field.id}-${opt.value}-value`;
                            const unitId = `${field.id}-${opt.value}-units`;
                            const val = formData[valueId];
                            const displayVal = val ? `${val} ${formData[unitId]}` : '';
                            reportData.push([opt.text, displayVal]);
                            reportDataIds.push(`${section.id}-${field.id}-${opt.value}`);
                        });
                        return; // Done with this field
                    }
    
                    const value = formData[field.id];
                    let displayValue: string | null = null;
                    if (field.id === 'expansion-feature') {
                        const featureData = value as { [key: string]: number };
                        if (typeof featureData === 'object' && value !== null && Object.keys(featureData).length > 0) {
                            displayValue = Object.entries(featureData).map(([val, count]) => {
                                const optionText = field.checkboxOptions?.find(opt => opt.value === val)?.text || val;
                                if (val !== 'expansion_loop' && count > 1) {
                                    return `${optionText} (Qty: ${count})`;
                                }
                                return optionText;
                            }).join(', ');
                        }
                    } else if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)) {
                        const rawValueString = Array.isArray(value) ? value.join(', ') : String(value);
                        if (field.type === 'select') {
                            const options = (field.id === 'system-select') 
                                ? systemData[formData['doc-select'] as keyof typeof systemData] || [] 
                                : (field.id === 'support-method' || field.id === 'secondary-support-method' || field.id === 'tertiary-support-method')
                                ? supportMethodOptions
                                : (field.id === 'abutment-a-location' || field.id === 'abutment-b-location')
                                ? directionOptions
                                : field.options || [];
                            const selectedOption = options.find(opt => opt.value === rawValueString);
                            displayValue = selectedOption ? selectedOption.text : rawValueString.split('|')[0];
                        } else {
                            displayValue = rawValueString;
                        }
                    }
                    reportData.push([field.label, displayValue ?? '']);
                    reportDataIds.push(`${section.id}-${field.id}`);
                    
                    if (field.assessmentOptions) {
                        const assessmentValue = formData[`${field.id}-assessment`];
                        reportData.push([`${field.label} (Source)`, assessmentValue || '']);
                        reportDataIds.push(`${section.id}-${field.id}-assessment`);
                    }
                });
            });

            // Add Expansion Loop details to the PDF table data
            if (formData.expansion_loops && formData.expansion_loops.length > 0) {
                reportData.push([{ content: 'Expansion Loop Details', colSpan: 2, styles: { fontStyle: 'bold', fillColor: '#eef1f5', textColor: '#003366' } }]);
                reportDataIds.push('expansion_loops_section');
    
                formData.expansion_loops.forEach((loop: ExpansionLoopData, index: number) => {
                    const loopHeader = `Expansion Loop #${index + 1}`;
                    reportData.push([{ content: loopHeader, colSpan: 2, styles: { fontStyle: 'bold', fillColor: '#f8f9fa' } }]);
                    reportDataIds.push(`expansion_loop_${index}`);
    
                    reportData.push(['Leg 1 Dimension (ft)', loop.leg1]);
                    reportDataIds.push(''); // No ToC entry for these sub-items
                    reportData.push(['Leg 2 Dimension (ft)', loop.leg2]);
                    reportDataIds.push('');
                    reportData.push(['Leg 3 Dimension (ft)', loop.leg3]);
                    reportDataIds.push('');
                    reportData.push(['Dimension Source', loop.source]);
                    reportDataIds.push('');
                });
            }
    
            (doc as any).autoTable({
                startY: margin,
                head: [['Field', 'Value']],
                body: reportData,
                theme: 'grid',
                headStyles: { fillColor: [0, 90, 156] },
                didDrawCell: (data: any) => {
                    // Process once per row using the first column for efficiency.
                    if (data.column.index > 0) {
                        return;
                    }
                    
                    const rowIndex = data.row.index;
                    const uniqueId = reportDataIds[rowIndex];

                    if (uniqueId) {
                        const entry = tocMap.get(uniqueId);
                        // Set page number only if it hasn't been set yet.
                        // This handles rows that might span pages correctly.
                        if (entry && entry.contentPage === undefined) {
                            // FIX: Get the page number directly from the jsPDF instance,
                            // as data.pageNumber from the plugin can be unreliable.
                            entry.contentPage = doc.internal.getCurrentPageInfo().pageNumber;
                        }
                    }
                },
            });
    
            // =================================================================
            // PHOTOGRAPHS
            // =================================================================
            if (imageFiles.length > 0) {
                doc.addPage();
                
                const photosStartPage = doc.internal.getCurrentPageInfo().pageNumber;
                const photoEntry = tocMap.get('photographs');
                if (photoEntry) {
                    photoEntry.contentPage = photosStartPage;
                }
    
                let photoY = margin;
    
                doc.setFontSize(16);
                doc.setFont('helvetica', 'bold');
                doc.text('Photographs and Attachments', margin, photoY);
                photoY += 10;
                
                for (const file of imageFiles) {
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
                    
                    try {
                        doc.addImage(file.dataUrl, file.type.split('/')[1].toUpperCase(), margin, photoY, imgWidth, imgHeight);
                    } catch (e) {
                        console.error("Error adding image to PDF:", e);
                        doc.setFont('helvetica', 'normal').setTextColor(255, 0, 0);
                        doc.text(`Error rendering image: ${file.name}`, margin, photoY);
                        doc.setTextColor(0, 0, 0);
                    }
                    
                    if (file.comment) {
                        doc.setFontSize(9);
                        doc.setFont('helvetica', 'italic');
                        const commentLines = doc.splitTextToSize(file.comment, imgWidth);
                        doc.text(commentLines, margin, photoY + imgHeight + 4);
                        doc.setFont('helvetica', 'normal');
                    }
                    
                    photoY += imgHeight + commentHeight + spacing;
                }
            }
    
            // =================================================================
            // PASS 3: GO BACK AND FILL IN TABLE OF CONTENTS PAGE NUMBERS
            // =================================================================
            for (const entry of tocEntries) {
                if (entry.contentPage) {
                    doc.setPage(entry.tocPage);
                    doc.setFontSize(entry.level === 0 ? 12 : 10);
                    doc.setFont('helvetica', 'normal'); // Font style set per-entry, so normal here is fine.
    
                    const pageNum = String(entry.contentPage);
                    doc.text(pageNum, pageWidth - margin, entry.y, { align: 'right' });
                }
            }
    
            // =================================================================
            // FINAL STEP: ADD HEADERS/FOOTERS AND SAVE
            // =================================================================
            addHeaderFooter();
            const date = new Date().toISOString().split('T')[0];
            doc.save(`pipeline-assessment-report-${formData['crossing-id'] || 'untitled'}-${date}.pdf`);
    
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
            "assessment-by": "Dana Argo, P.E.",
            "doc-select": "nu-nh",
            "crossing-id": "BR-214 - Route 1A Bridge",
            "town-city": "Dover, NH",
            "crossing-description": "8-inch steel pipeline is attached to the downstream (east) side of the Route 1A bridge, spanning the Cocheco River. Access is available from the public boat launch area on the north bank.",
            "gps-lat": "43.1959° N",
            "gps-lon": "70.8711° W",
            "road-name": "Route 1A / Dover Point Road",
            "feature-crossed": "Cocheco River",
            "bridge-name": "General Sullivan Bridge",
            "bridge-number": "105/095",
            "bridge-type": "girder",
            "bridge-material": "steel",
            "ambient-temp": "72",
            "weather-conditions": "Partly cloudy, 72°F with a light 5 mph wind from the southwest. Conditions were dry and safe for inspection.",
            "vegetation-growth": "Minor vegetation and grass growth was observed at both the north and south abutments. All growth is well clear of the pipeline and support structures and does not impede access or visual inspection.",
            "scour-erosion": "No evidence of significant scour or erosion was observed at the visible portions of the bridge piers or abutments. The river banks appear stable.",
            "proximity-water": "The pipeline is approximately 25 feet above the mean high water mark.",
            "debris-accumulation": "A small amount of driftwood was observed near the base of the central pier, but it is not in contact with or posing a threat to the bridge structure or pipeline.",
            "system-select": "Dover IP|55 PSIG",
            "maop": "55 PSIG",
            "pipe-diameter": "8",
            "wall-thickness": "0.322",
            "wall-thickness-assessment": "Obtained from records",
            "wall-thickness-comments": "Wall thickness was obtained from original installation records and spot-checked with a UT gauge at the north abutment. Readings were consistent with records.",
            "pipe-material": "steel",
            "pipe-grade": "x42",
            "pipe-grade-assessment": "From records",
            "plastic-pipe-grade": "",
            "pipe-sdr": "",
            "installation-temp": "65",
            "installation-temp-assessment": "Documented in Original Installation Records",
            "abutment-a-location": "north",
            "abutment-b-location": "south",
            "support-method": "hangers",
            "primary-support-count": "24",
            "primary-support-dist-left": "15.5",
            "primary-support-dist-left-assessment": "Measured",
            "primary-support-dist-right": "15.5",
            "primary-support-dist-right-assessment": "Measured",
            "secondary-support-method": "rollers",
            "secondary-support-count": "2",
            "secondary-support-dist-left": "0.5",
            "secondary-support-dist-left-assessment": "Measured",
            "secondary-support-dist-right": "15.5",
            "secondary-support-dist-right-assessment": "Measured",
            "tertiary-support-method": "",
            "tertiary-support-count": "",
            "tertiary-support-dist-left": "",
            "tertiary-support-dist-left-assessment": "Estimated",
            "tertiary-support-dist-right": "",
            "tertiary-support-dist-right-assessment": "Estimated",
            "other-support-specify": "",
            "support-condition-thermal-stress-comments": "No signs of significant thermal stress. Hangers appear to be in good condition, allowing for movement.",
            "pipe-movement-at-supports-comments": "Pipe appears to be adequately supported with no undue restrictions from the primary hanger supports.",
            "sliding-roller-functionality-comments": "The two roller supports at the north and south abutments show signs of stiffness. They are not seized, but movement appears partially restricted. Recommend cleaning and lubrication.",
            "support-comments": "All U-bolts and fasteners are tight. Minor surface corrosion noted on several nuts, but no section loss observed. Overall condition is satisfactory.",
            "expansion-feature": { "pipe_flexibility": 1 },
            "expansion_loops": [],
            "other-expansion-specify": "",
            "expansion-feature-functionality-comments": "The crossing relies on designed flexibility, incorporating several long-radius bends on the approaches, to accommodate thermal expansion and contraction. There are no signs of restraint or excessive stress at these bends.",
            "expansion-comments": "The method for accommodating thermal movement appears to be functioning as designed.",
            "coating-type": "fusion-bonded-epoxy",
            "other-coating-type-specify": "",
            "coating-comments": "Coating is generally in good condition. A 2-inch scratch with minor surface rust was identified on the top of the pipe at support H-12. No other holidays or damage found during the visual inspection.",
            "pipe-physical-damage": "No physical damage (dents, gouges) was observed on the pipeline.",
            "atmospheric-corrosion-details": "Minor surface rust noted on the scratch at H-12. No other atmospheric corrosion was observed on the pipe body.",
            "clearance-group-v-hwy-value": "25",
            "clearance-group-v-hwy-units": "ft",
            "clearance-group-h-hwy-value": "",
            "clearance-group-h-hwy-units": "ft",
            "clearance-group-v-water-value": "25",
            "clearance-group-v-water-units": "ft",
            "clearance-group-h-abutment-value": "24",
            "clearance-group-h-abutment-units": "in",
            "clearance-comments": "All clearances meet or exceed requirements.",
            "safety-hazards": "High-volume, high-speed vehicle traffic on the bridge deck. Work requires fall protection equipment and certified traffic control.",
            "access-structures-condition": "N/A - no permanent access structures.",
            "access-safety-comments": "Access for future maintenance will require a snooper truck or under-bridge rigging, in addition to lane closures.",
            "other-utilities-bridge": "A conduit for telecommunications is also attached to the east side, approximately 4 feet below the gas line.",
            "bridge-structure-condition": "The bridge's concrete deck and steel girders appear to be in fair condition. Some minor spalling was noted on the south abutment wall, but it does not appear to affect the pipeline supports.",
            "third-party-damage-potential": "Low potential for third-party damage due to the pipeline's elevation and position away from the roadway.",
            "third-party-comments": "The adjacent telecom conduit is well-secured and poses no immediate threat.",
            "immediate-hazards": "None identified.",
            "actions-taken-hazards": "N/A",
            "recommendation-priority": "medium",
            "recommendations-summary": "1. Clean and lubricate the two roller supports at the north and south abutments.\n2. At support H-12, mechanically clean the 2-inch scratch to bare metal and apply a compatible repair coating.\n3. Continue monitoring on the standard inspection cycle.",
            "final-summary-evaluation": "The pipeline at this crossing is in generally good condition and fit for service. The primary support hangers are secure, and clearances are adequate. Two minor maintenance items were identified: stiff roller supports and a small coating scratch requiring repair. These items have been assigned a medium priority for resolution to ensure the long-term integrity of the crossing. No immediate hazards were identified.",
            "fileData": {
                "photographs": [
                    { "name": "View_from_North_Abutment.jpg", "comment": "Photo taken from the north abutment looking south along the pipeline.", "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "type": "image/jpeg" },
                    { "name": "Coating_Scratch_H12.jpg", "comment": "Close-up of the coating scratch identified at support H-12.", "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "type": "image/jpeg" },
                    { "name": "South_Roller_Support.jpg", "comment": "View of the roller support at the south abutment, showing signs of stiffness.", "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "type": "image/jpeg" }
                ],
                "other-docs": []
            }
        };
        populateFormWithData(exampleData);
    }
    
    function handleAdminLock() {
        document.body.classList.remove('voice-enabled');
        adminUnlockedView.style.display = 'none';
        adminLockedView.style.display = 'flex';
        adminPasswordInput.value = '';
    }

    function handleAdminUnlock() {
        const password = adminPasswordInput.value;
        if (password === "0665") {
            document.body.classList.add('voice-enabled');
            adminLockedView.style.display = 'none';
            adminUnlockedView.style.display = 'flex';
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
    
    adminUnlockButton.addEventListener('click', handleAdminUnlock);
    adminLockButton.addEventListener('click', handleAdminLock);
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
    handleDocChange(); // Initial call to set up the system select container correctly
    handlePipeMaterialChange(); // Initial call to set up conditional pipe fields
});