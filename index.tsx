// index.tsx
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// The API key provided by the user.
const API_KEY = "26936b7e5c4421b39703b65dd558dc19b8587245";

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
    type: 'text' | 'number' | 'select' | 'checkbox-group' | 'radio-group' | 'textarea' | 'file' | 'date';
    placeholder?: string;
    options?: { value: string; text: string }[];
    checkboxOptions?: CheckboxOption[]; // Used for checkbox-group and radio-group
    required?: boolean;
    defaultValue?: string;
    multiple?: boolean; // For file input
    accept?: string;    // For file input MIME types
    assessmentOptions?: string[]; // For number fields, e.g., ["Measured", "Estimated", "Could not Assess"]
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
    'final-summary-evaluation'
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

            const previewSrc = fileInfo.dataUrl;
            
            // Updated logic to handle renderable vs non-renderable images
            if (fileInfo.type.startsWith('image/') && fileInfo.type !== 'image/tiff') {
                const img = document.createElement('img');
                img.src = previewSrc;
                img.classList.add('file-thumbnail');
                img.alt = `Thumbnail for ${fileInfo.name}`;
                filePreviewContainer.appendChild(img);
            } else if (fileInfo.type.startsWith('image/')) { // Handles TIFF and other image types without direct browser preview support
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
        const originalText = inputElement.value.trim();
        if (!originalText) {
            alert("There is no text to improve.");
            return;
        }

        improveButton.disabled = true;
        improveButton.textContent = 'Working...';
        
        // Remove any old suggestions
        const oldSuggestions = wrapper.querySelector('.suggestions-container');
        if (oldSuggestions) {
            oldSuggestions.remove();
        }
        
        try {
            const ai = new GoogleGenAI({apiKey: API_KEY});

            const prompt = `Rewrite the following text for a professional engineering field report. Provide 3 distinct alternative versions in a JSON array format, like ["suggestion 1", "suggestion 2", "suggestion 3"]. Improve clarity, grammar, and sentence structure, but preserve all original facts and the core meaning. Do not add any new information. Original text: "${originalText}"`;
            
            const response: GenerateContentResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-04-17',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                }
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
                    throw new Error("Parsed data is not an array of strings.");
                }
            } catch (e) {
                console.error("Failed to parse JSON response, treating as single suggestion:", e);
                suggestions = [response.text]; // Fallback to single suggestion
            }

            if (suggestions.length === 0) {
                alert("Could not generate improvement suggestions.");
                return;
            }

            // Create and display suggestions container
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
                item.tabIndex = 0; // Make it focusable
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
    if (!SpeechRecognition) {
        console.warn("Speech Recognition API not supported in this browser.");
        return;
    }

    const micButton = document.createElement('button');
    micButton.type = 'button';
    micButton.classList.add('mic-button');
    micButton.innerHTML = '&#127908;'; // Microphone emoji
    micButton.setAttribute('aria-label', `Start voice input for ${inputElement.id}`);

    micButton.addEventListener('click', () => {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        micButton.classList.add('listening');

        recognition.onend = () => {
            micButton.classList.remove('listening');
        };

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
    if (field.type !== 'checkbox-group' && field.type !== 'radio-group' && !field.assessmentOptions) {
        fieldContainer.appendChild(labelElement);
    }


    if (field.type === 'select') {
        const select = document.createElement('select');
        select.id = field.id;
        select.name = field.id;
        if (field.required) select.required = true;

        let hasDefaultPlaceholder = false;
        if (field.options) {
            field.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                if (opt.value === '' && !field.defaultValue) {
                    option.disabled = true;
                    option.selected = true; 
                    hasDefaultPlaceholder = true;
                }
                select.appendChild(option);
            });
        }
        if (field.defaultValue) {
            select.value = field.defaultValue;
        } else if (hasDefaultPlaceholder && field.options && field.options.length > 0 && select.selectedIndex === -1) {
            const placeholderOption = Array.from(select.options).find(o => o.value === '');
            if (placeholderOption) placeholderOption.selected = true;
        }
        fieldContainer.appendChild(select);
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
                input.name = field.type === 'radio-group' ? field.id : input.id; // Radios in a group must have the same name
                input.value = opt.value;

                const itemLabel = document.createElement('label');
                itemLabel.htmlFor = input.id;
                itemLabel.textContent = opt.text;

                itemContainer.appendChild(input);
                itemContainer.appendChild(itemLabel);
                fieldset.appendChild(itemContainer);
            });
        }
        fieldContainer.appendChild(fieldset);
    } else if (field.type === 'textarea') {
        const inputWrapper = document.createElement('div');
        inputWrapper.classList.add('input-with-mic-wrapper');
        
        const inputElement = document.createElement('textarea');
        inputElement.id = field.id;
        inputElement.name = field.id;
        if (field.placeholder) inputElement.placeholder = field.placeholder;
        if (field.required) inputElement.required = true;
        inputElement.spellcheck = true;

        inputElement.addEventListener('input', () => autoResizeTextarea(inputElement));
        
        inputWrapper.appendChild(inputElement);

        if (voiceEnabledFieldIds.includes(field.id)) {
            addImproveButton(inputWrapper, inputElement);
            addMicrophoneButton(inputWrapper, inputElement);
        }

        fieldContainer.appendChild(inputWrapper);

    } else if (field.type === 'text' || field.type === 'date') {
        const inputElement = document.createElement('input');
        inputElement.type = field.type;
        inputElement.id = field.id;
        inputElement.name = field.id;
        if (field.placeholder) inputElement.placeholder = field.placeholder;
        if (field.required) inputElement.required = true;
        
        if(field.type === 'text') {
            inputElement.spellcheck = true; // Enable native spell check
        }
        fieldContainer.appendChild(inputElement);
    } else if (field.type === 'file') {
        // Initialize the data store for this file input
        fileDataStore[field.id] = [];

        const input = document.createElement('input');
        input.type = 'file';
        input.id = field.id;
        input.name = field.id;
        if (field.multiple) input.multiple = true;
        if (field.accept) input.accept = field.accept;
        fieldContainer.appendChild(input);

        const fileListContainer = document.createElement('div');
        fileListContainer.id = `${field.id}-list-container`;
        fileListContainer.classList.add('file-list-container');
        fieldContainer.appendChild(fileListContainer);
        
        input.addEventListener('change', async (event) => {
            const selectedFiles = (event.target as HTMLInputElement).files;
            if (!selectedFiles || selectedFiles.length === 0) {
                fileDataStore[field.id] = [];
                renderFileList(field.id);
                return;
            }

            // You can add a loading indicator here if needed
            const newFiles: FileWithComment[] = [];
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                try {
                    const dataUrl = await readFileAsDataURL(file);
                    newFiles.push({
                        name: file.name,
                        comment: '', // New files have empty comments by default
                        dataUrl: dataUrl,
                        type: file.type || 'application/octet-stream'
                    });
                } catch (error) {
                    console.error(`Error reading file ${file.name}:`, error);
                    alert(`Could not process the file: ${file.name}`);
                }
            }

            // Replace the existing files in the store with the new selection
            fileDataStore[field.id] = newFiles;
            renderFileList(field.id);
        });

        renderFileList(field.id); // Initial render (will show "No files selected")
    } else if (field.type === 'number') {
        // For number fields with assessment options, the label is handled differently (in the radiogroup's aria-label)
        // so we only add it here if there are NO assessment options.
        if (!field.assessmentOptions) {
             fieldContainer.insertBefore(labelElement, fieldContainer.firstChild); 
        } else {
             // For a better layout, we create a wrapper for the label and input
            const numberInputContainer = document.createElement('div');
            numberInputContainer.classList.add('number-input-container');
            labelElement.classList.add('number-input-label'); // Add a class for specific styling
            numberInputContainer.appendChild(labelElement);
    
            const input = document.createElement('input');
            input.type = 'number';
            input.id = field.id;
            input.name = field.id;
            if (field.placeholder) input.placeholder = field.placeholder;
            if (field.required) input.required = true;
            input.step = 'any'; 
            
            numberInputContainer.appendChild(input);
            fieldContainer.appendChild(numberInputContainer);
        }
        
        if (!field.assessmentOptions) {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = field.id;
            input.name = field.id;
            if (field.placeholder) input.placeholder = field.placeholder;
            if (field.required) input.required = true;
            input.step = 'any'; 
            fieldContainer.appendChild(input);
        }


        if (field.assessmentOptions && field.assessmentOptions.length > 0) {
            const assessmentGroup = document.createElement('div');
            assessmentGroup.classList.add('assessment-options-group');
            assessmentGroup.setAttribute('role', 'radiogroup');
            assessmentGroup.setAttribute('aria-label', `${field.label} - Measurement Type`);


            field.assessmentOptions.forEach(optText => {
                const wrapper = document.createElement('div');
                wrapper.classList.add('radio-item-inline');

                const radio = document.createElement('input');
                radio.type = 'radio';
                const radioId = `${field.id}-assessment-${optText.toLowerCase().replace(/\s+/g, '-')}`;
                radio.id = radioId;
                radio.name = `${field.id}-assessment-type`; 
                radio.value = optText;
                
                // Set default to blank by not having a checked radio button initially
                if (field.defaultValue && field.defaultValue === optText) {
                    radio.checked = true;
                }

                const radioLabel = document.createElement('label');
                radioLabel.htmlFor = radioId;
                radioLabel.textContent = optText;

                wrapper.appendChild(radio);
                wrapper.appendChild(radioLabel);
                assessmentGroup.appendChild(wrapper);
            });
            fieldContainer.appendChild(assessmentGroup);
        }
    } else { 
        const input = document.createElement('input');
        input.type = field.type as string;
        input.id = field.id;
        input.name = field.id;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.required) input.required = true;
        fieldContainer.appendChild(input);
    }
    return fieldContainer;
}

function createSectionElement(title: string, sectionId: string, fields: FormField[], sectionNumber: number): HTMLElement {
    const section = document.createElement('section');
    section.id = sectionId;
    section.classList.add('form-section');
    section.setAttribute('aria-labelledby', `${sectionId}-title`);

    const sectionTitle = document.createElement('h2');
    sectionTitle.id = `${sectionId}-title`;
    sectionTitle.innerHTML = `<span class="section-number">${sectionNumber}</span> ${title}`;
    section.appendChild(sectionTitle);

    fields.forEach(field => {
        section.appendChild(createFieldElement(field));
    });

    return section;
}

// Data structures for DOC-specific systems
interface RawSystemEntry {
  ds: string;
  name: string;
  maopStr: string; // e.g., "56 PSIG", "13.8\" W.C."
}

interface ProcessedSystemEntry {
  originalIndex: number;
  ds: string;
  name: string;
  maopValue: number;
  maopUnit: 'psig' | 'wc';
  displayText: string;
}

function parseMaopString(maopStr: string): { value: number; unit: 'psig' | 'wc' } {
  const wcMatch = maopStr.match(/([\d.]+)\s*("\s*W\.C\.|\s*WC)/i);
  if (wcMatch) {
    return { value: parseFloat(wcMatch[1]), unit: 'wc' };
  }
  const psigMatch = maopStr.match(/([\d.]+)\s*(PSIG|PSI)?/i);
  if (psigMatch) {
    return { value: parseFloat(psigMatch[1]), unit: 'psig' };
  }
  // Default to PSIG if only a number is found and no unit identified
  const numOnlyMatch = maopStr.match(/^[\d.]+$/);
  if (numOnlyMatch) {
      return { value: parseFloat(maopStr), unit: 'psig'};
  }
  console.warn(`Could not parse MAOP string: ${maopStr}. Defaulting to 0 PSIG.`);
  return { value: 0, unit: 'psig' }; // Fallback
}

function processRawSystemData(rawData: RawSystemEntry[], systemType: string): ProcessedSystemEntry[] {
  const processed: ProcessedSystemEntry[] = [];
  const uniqueSystemStrings = new Set<string>();

  rawData.forEach((item) => {
    const { value: maopValue, unit: maopUnit } = parseMaopString(item.maopStr);
    const uniqueKey = `${item.ds}|${item.name}|${maopValue}|${maopUnit}`;

    if (!uniqueSystemStrings.has(uniqueKey)) {
      uniqueSystemStrings.add(uniqueKey);
      processed.push({
        originalIndex: -1, // Will be set later after sorting
        ds: item.ds,
        name: item.name,
        maopValue,
        maopUnit,
        displayText: `${item.ds} - ${item.name} (${maopValue} ${maopUnit === 'wc' ? 'in W.C.' : 'PSIG'})`
      });
    }
  });

  // Sort for better dropdown usability
  processed.sort((a, b) => {
    if (a.ds !== b.ds) return a.ds.localeCompare(b.ds);
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.maopValue - b.maopValue;
  });

  // Assign originalIndex after sorting
  return processed.map((item, index) => ({ ...item, originalIndex: index }));
}


// NU Maine Data
const rawNuMeSystemsData: RawSystemEntry[] = [
  { ds: '510', name: 'Lewiston-Auburn IP', maopStr: '56 PSIG' }, { ds: '514', name: 'Poland Road IP', maopStr: '80 PSIG' },
  { ds: '502', name: 'Biddeford Industrial Park', maopStr: '40 PSIG' }, { ds: '501', name: 'Railroad Avenue', maopStr: '56 PSIG' },
  { ds: '550', name: 'Bolt Hill Road', maopStr: '99 PSIG' }, { ds: '549', name: 'Levesque Drive', maopStr: '99 PSIG' },
  { ds: '553', name: 'Sanborn Lane', maopStr: '99 PSIG' }, { ds: '507', name: 'Debbie Lane', maopStr: '500 PSIG' },
  { ds: '503', name: 'Twine Mill', maopStr: '99 PSIG' }, { ds: '504', name: 'PNSY', maopStr: '99 PSIG' },
  { ds: '508', name: 'Shapleigh Lane', maopStr: '56 PSIG' }, { ds: '506', name: 'Shephard\'s Cove', maopStr: '99 PSIG' },
  { ds: '551', name: 'Dennet St', maopStr: '99 PSIG' }, { ds: '552', name: 'Wilson Road', maopStr: '99 PSIG' },
  { ds: '513', name: 'Lisbon 99 PSIG', maopStr: '99 PSIG' }, { ds: '512', name: 'Lewiston High Line', maopStr: '250 PSIG' },
  { ds: '509', name: 'Goddard Road', maopStr: '56 PSIG' }, { ds: '546', name: 'Poland Road HP', maopStr: '99 PSIG' },
  { ds: '505', name: 'River Road IP', maopStr: '56 PSIG' }, { ds: '516', name: 'Northeast Millworks', maopStr: '56 PSIG' },
  { ds: '516', name: 'Hussey Seating', maopStr: '25 PSIG' }, { ds: '517', name: 'Pratt & Whitney', maopStr: '99 PSIG' },
  { ds: '515', name: 'Pineland', maopStr: '99 PSIG' }, { ds: '519', name: 'Cascade Road', maopStr: '56 PSIG' },
  { ds: '525', name: 'Blueberry Road', maopStr: '60 PSIG' }, { ds: '543', name: 'Larrabee Road', maopStr: '56 PSIG' },
  { ds: '543', name: 'Larrabee Road', maopStr: '30 PSIG' }, { ds: '541', name: 'Payne Road', maopStr: '200 PSIG' },
  { ds: '521', name: 'Congress St 125 PSIG System', maopStr: '125 PSIG' }, { ds: '548', name: 'Thompson\'s Point', maopStr: '99 PSIG' },
  { ds: '526', name: '380 Riverside', maopStr: '56 PSIG' }, { ds: '527', name: '470 Riverside', maopStr: '56 PSIG' },
  { ds: '554', name: 'Regan Lane', maopStr: '30 PSIG' }, { ds: '520', name: 'Waldo Street', maopStr: '30 PSIG' },
  { ds: '529', name: 'Riverside @ Waldron', maopStr: '56 PSIG' }, { ds: '542', name: 'Marshwood High School', maopStr: '56 PSIG' },
  { ds: '539', name: 'South Portland', maopStr: '30 PSIG' }, { ds: '540', name: 'Darling Avenue', maopStr: '99 PSIG' },
  { ds: '534', name: 'Saco Brick', maopStr: '56 PSIG' }, { ds: '536', name: 'Roundwood', maopStr: '30 PSIG' },
  { ds: '537', name: 'Scarborough Industrial Park', maopStr: '56 PSIG' }, { ds: '535', name: 'Route 109', maopStr: '56 PSIG' },
  { ds: '555', name: 'Sandford West', maopStr: '99 PSIG' }, { ds: '545', name: 'Westgate', maopStr: '56 PSIG' },
];
const nuMeSystems: ProcessedSystemEntry[] = processRawSystemData(rawNuMeSystemsData, "NU Maine");

// NU New Hampshire Data
const rawNuNhSystemsData: RawSystemEntry[] = [
    { ds: "NH 22", name: "Dover-Somersworth", maopStr: "397 PSIG" }, { ds: "NH 30", name: "Dover LP", maopStr: "13.8\" W.C." },
    { ds: "NH 29", name: "Dover IP", maopStr: "55 PSIG" }, { ds: "NH 24", name: "UNH, Dover", maopStr: "99 PSIG" },
    { ds: "NH 26", name: "Dover Industrial Pk (Crosby)", maopStr: "55 PSIG" }, { ds: "NH 25", name: "Locust / Cataract, Dover", maopStr: "55 PSIG" },
    { ds: "NH 20", name: "Dover Pt Road", maopStr: "56 PSIG" }, { ds: "NH 54", name: "College Road", maopStr: "56 PSIG" },
    { ds: "NH 27", name: "Mill Road, Durham", maopStr: "56 PSIG" }, { ds: "NH 62", name: "Gables Way (UNH)", maopStr: "56 PSIG" },
    { ds: "NH 51", name: "Strafford Ave", maopStr: "56 PSIG" }, { ds: "NH 03", name: "East Kingston", maopStr: "125 PSIG" },
    { ds: "NH 09", name: "Exeter IP", maopStr: "56 PSIG" }, { ds: "NH 11", name: "Guinea Road, Exeter", maopStr: "56 PSIG" },
    { ds: "NH 08", name: "Exeter-Hampton", maopStr: "171 PSIG" }, { ds: "NH 12", name: "Route 88, Exeter", maopStr: "50 PSIG" },
    { ds: "NH 61", name: "Exeter/Brentwood Expansion", maopStr: "99 PSIG" }, { ds: "NH 38", name: "Fairway, Gonic", maopStr: "56 PSIG" },
    { ds: "NH 37", name: "Felker Street, Gonic", maopStr: "56 PSIG" }, { ds: "NH 39", name: "Gear Road, Gonic", maopStr: "56 PSIG" },
    { ds: "NH 60", name: "Brox Line", maopStr: "99 PSIG" }, { ds: "NH 15", name: "Rte 151, Greenland", maopStr: "56 PSIG" },
    { ds: "NH 14", name: "Hampton IP", maopStr: "45 PSIG" }, { ds: "NH 13", name: "Liberty Lane, Hampton", maopStr: "45 PSIG" },
    { ds: "NH 44", name: "Timber Swamp Rd, Hampton", maopStr: "60 PSIG" }, { ds: "NH 63", name: "Exeter Rd/Falcone Circle", maopStr: "99 PSIG" },
    { ds: "NH 64", name: "Gale Road, Hampton", maopStr: "56 PSIG" }, { ds: "NH 65", name: "Heritage Drive, Hampton", maopStr: "56 PSIG" },
    { ds: "NH 69", name: "Labrador Lane", maopStr: "99 PSIG" }, { ds: "NH 04", name: "Hog's Hill, Kensington", maopStr: "99 PSIG" },
    { ds: "NH 17", name: "Portsmouth IP", maopStr: "56 PSIG" }, { ds: "NH 02", name: "Plaistow, IP", maopStr: "56 PSIG" },
    { ds: "NH 18", name: "Portsmouth LP", maopStr: "13.8\" W.C." }, { ds: "NH 16", name: "Portsmouth Lateral", maopStr: "270 PSIG" },
    { ds: "NH 40", name: "Rochester IP", maopStr: "45 PSIG" }, { ds: "NH 67", name: "Aruba Drive, Rochester", maopStr: "99 PSIG" },
    { ds: "NH 68", name: "Profile Apartments, Rochester", maopStr: "56 PSIG" }, { ds: "NH 66", name: "Rochester IP", maopStr: "45 PSIG" },
    { ds: "NH 41", name: "Salem IP", maopStr: "60 PSIG" }, { ds: "NH 07", name: "Seabrook IP", maopStr: "56 PSIG" },
    { ds: "NH 06", name: "Andys Mobile Ct., Seabrook", maopStr: "56 PSIG" }, { ds: "NH 05", name: "Dog Track, Seabrook", maopStr: "56 PSIG" },
    { ds: "NH 35", name: "Oak Hill Mobile Pk, Somersworth", maopStr: "56 PSIG" }, { ds: "NH 32", name: "Somersworth IP", maopStr: "50 PSIG" },
    { ds: "NH 31", name: "Rochester 150# line", maopStr: "150 PSIG" }, { ds: "NH 43", name: "Stratham Ind Park", maopStr: "56 PSIG" },
];
const nuNhSystems: ProcessedSystemEntry[] = processRawSystemData(rawNuNhSystemsData, "NU New Hampshire");

// FG&E Data
const rawFgAndESystemsData: RawSystemEntry[] = [
    { ds: "302", name: "Fitchburg LP", maopStr: "14\" W.C." }, { ds: "305", name: "Fitchburg IP", maopStr: "20 PSIG" },
    { ds: "307", name: "Baltic Lane LP", maopStr: "14\" W.C." }, { ds: "303", name: "Gardner LP", maopStr: "14\" W.C." },
    { ds: "301", name: "Fitchburg HP", maopStr: "99 PSIG" }, { ds: "304", name: "Depot Road", maopStr: "30 PSIG" },
];
const fgAndESystems: ProcessedSystemEntry[] = processRawSystemData(rawFgAndESystemsData, "FG&E");

// Bangor Natural Gas Data
const rawBngSystemsData: RawSystemEntry[] = [
  { ds: 'BNG', name: 'Bangor Steel', maopStr: '500 PSIG' },
  { ds: 'BNG', name: 'Lincoln', maopStr: '60 PSIG' },
  { ds: 'BNG', name: 'Bangor IP', maopStr: '60 PSIG' },
  { ds: 'BNG', name: 'Brewer', maopStr: '60 PSIG' },
  { ds: 'BNG', name: 'Searsport', maopStr: '60 PSIG' },
  { ds: 'BNG', name: 'Orrington', maopStr: '720 PSIG' },
  { ds: 'BNG', name: 'Bucksport', maopStr: '60 PSIG' },
];
const bngSystems: ProcessedSystemEntry[] = processRawSystemData(rawBngSystemsData, "Bangor Natural Gas");


// --- Define all form sections and fields globally ---
const allFormSections: FormSectionData[] = [
    {
        title: 'General Site & Crossing Information',
        id: 'section-general-info',
        fields: [
            { label: 'Date of Assessment:', id: 'assessment-date', type: 'date', required: true },
            { label: 'Assessment By:', id: 'assessor-name', type: 'text', placeholder: 'Enter name(s) of assessor(s)', required: true },
            {
                label: 'District Operating Center (DOC):', id: 'doc-center', type: 'select', required: true,
                options: [
                    { value: '', text: 'Select DOC...' }, { value: 'bng', text: 'Bangor Natural Gas' },
                    { value: 'mng', text: 'Maine Natural Gas' }, { value: 'nu_me', text: 'Northern Utilities - Maine' },
                    { value: 'nu_nh', text: 'Northern Utilities - New Hampshire' }, { value: 'fge', text: 'FG&E' },
                    { value: 'gsgt', text: 'GSGT' }, { value: 'unh_eco', text: 'UNH-ECO-Line' },
                ]
            },
            { label: 'Crossing Identification Number:', id: 'crossing-id', type: 'text', placeholder: 'e.g., ME-RIV-001', required: true },
            { label: 'Description of Crossing/Work Location:', id: 'crossing-description', type: 'textarea', placeholder: 'Provide a brief description of the specific location, access points, or any immediate observations about the work area.' },
            { label: 'GPS Latitude:', id: 'gps-lat', type: 'text', placeholder: 'e.g., 43.6591° N' },
            { label: 'GPS Longitude:', id: 'gps-lon', type: 'text', placeholder: 'e.g., 70.2568° W' },
        ]
    },
    {
        title: 'Bridge & Environmental Context',
        id: 'section-bridge-environmental',
        fields: [
            { label: 'Road Name:', id: 'road-name', type: 'text', placeholder: 'e.g., Main Street' },
            { label: 'Feature Crossed:', id: 'feature-crossed', type: 'text', placeholder: 'e.g., Saco River, I-95' },
            { label: 'Bridge Name:', id: 'bridge-name', type: 'text', placeholder: 'e.g., Main Street Bridge' },
            { label: 'Bridge Number:', id: 'bridge-number', type: 'text', placeholder: 'e.g., B78-002' },
            {
                label: 'Bridge Type:', id: 'bridge-type', type: 'select', options: [
                    { value: '', text: 'Select Bridge Type...' }, { value: 'girder', text: 'Girder (Steel or Concrete)' },
                    { value: 'truss', text: 'Truss' }, { value: 'arch', text: 'Arch' },
                    { value: 'suspension', text: 'Suspension' }, { value: 'culvert', text: 'Culvert' }, { value: 'other', text: 'Other' }
                ]
            },
            {
                label: 'Bridge Material:', id: 'bridge-material', type: 'select', options: [
                    { value: '', text: 'Select Bridge Material...' }, { value: 'steel', text: 'Steel' },
                    { value: 'concrete', text: 'Concrete (Reinforced or Prestressed)' }, { value: 'wood', text: 'Wood' },
                    { value: 'composite', text: 'Composite (Steel & Concrete)' }, { value: 'masonry', text: 'Masonry' }, { value: 'other', text: 'Other' }
                ]
            },
            { label: 'Ambient Temperature at time of inspection (°F):', id: 'ambient-temp', type: 'number', placeholder: 'e.g., 65' },
            { label: 'General Weather Conditions:', id: 'weather-conditions', type: 'textarea', placeholder: 'e.g., Sunny and clear, Overcast, Light rain' },
            { label: 'Vegetation Growth Around Pipeline/Supports:', id: 'vegetation-growth', type: 'textarea', placeholder: 'Describe vegetation, e.g., None, Minor, Overgrown, Trees/Roots impacting.' },
            { label: 'Evidence of Scour or Erosion Near Supports/Pipeline:', id: 'scour-erosion', type: 'textarea', placeholder: 'Describe any scour or erosion observed.' },
            { label: 'Proximity to Water Body/Wetlands:', id: 'proximity-water', type: 'textarea', placeholder: 'Describe proximity and potential impact.' },
            { label: 'Signs of Debris Accumulation Around Pipeline/Supports:', id: 'debris-accumulation', type: 'textarea', placeholder: 'Describe any debris build-up.' },
        ]
    },
    {
        title: 'Pipeline Identification & Specifications',
        id: 'section-pipeline-details',
        fields: [
            {
                label: 'Pipeline Material:', id: 'pipeline-material', type: 'select', required: true,
                options: [
                    { value: '', text: 'Select Material...' }, { value: 'steel_pipe', text: 'Steel Pipe' },
                    { value: 'steel_pipe_casing', text: 'Steel Pipe in casing' }, { value: 'plastic_pipe_casing', text: 'Plastic pipe in casing' },
                ]
            },
            {
                label: 'Pipeline Diameter (inches):', id: 'pipeline-diameter', type: 'select', required: true,
                options: [
                    { value: '', text: 'Select Diameter...' }, { value: '2', text: '2"' }, { value: '3', text: '3"' },
                    { value: '4', text: '4"' }, { value: '6', text: '6"' }, { value: '8', text: '8"' },
                    { value: '10', text: '10"' }, { value: '12', text: '12"' }, { value: 'other', text: 'Other (Specify)'},
                ]
            },
            { label: 'Other Pipeline Diameter (Specify):', id: 'pipeline-diameter-other', type: 'text', placeholder: 'Specify other diameter' },
            {
                label: 'Pipe Wall Thickness (Inches):',
                id: 'pipe-wall-thickness',
                type: 'number',
                placeholder: 'e.g., 0.280',
                assessmentOptions: ["Measured", "Stamped on Pipe", "Obtained from records"]
            },
            {
                label: 'Installation Temperature (In Deg F.):',
                id: 'installation-temp',
                type: 'number',
                placeholder: 'e.g., 55',
                assessmentOptions: ["Assumed", "Documented in Original Installation Records", "Derived from historical temperatures based on installation date"]
            },
            {
                label: 'System (Bangor Natural Gas):', id: 'bng-system-select', containerId: 'bng-system-select-container',
                type: 'select', options: [{ value: '', text: 'Select System for Bangor Natural Gas...' }],
            },
            {
                label: 'System (NU Maine):', id: 'nu-me-system-select', containerId: 'nu-me-system-select-container',
                type: 'select', options: [{ value: '', text: 'Select System for NU Maine...' }],
            },
            {
                label: 'System (NU New Hampshire):', id: 'nu-nh-system-select', containerId: 'nu-nh-system-select-container',
                type: 'select', options: [{ value: '', text: 'Select System for NU New Hampshire...' }],
            },
            {
                label: 'System (FG&E):', id: 'fge-system-select', containerId: 'fge-system-select-container',
                type: 'select', options: [{ value: '', text: 'Select System for FG&E...' }],
            },
            {
                label: 'MAOP Unit:', id: 'maop-unit', type: 'select', required: true,
                options: [
                    { value: '', text: 'Select Unit...' }, { value: 'psig', text: 'PSIG' }, { value: 'wc', text: 'inches W.C.' }
                ]
            },
            { label: 'MAOP Value:', id: 'maop-value', type: 'number', placeholder: 'Enter MAOP Value', required: true }
        ]
    },
    {
        title: 'Pipeline Support & Anchorage System',
        id: 'section-pipeline-support',
        fields: [
            {
                label: 'Pipeline Support Method(s):', id: 'pipeline-support-methods', type: 'checkbox-group',
                checkboxOptions: [
                    { value: 'ring_girders', text: 'Ring Girders/Supports (Clamped to pipe)' }, { value: 'hangers_rods', text: 'Hangers/Rods (Suspended)' },
                    { value: 'rollers_sliding', text: 'Rollers/Sliding Supports' }, { value: 'stanchions_pedestals', text: 'Stanchions/Pedestals (Supported from below)' },
                    { value: 'trough_gallery', text: 'Contained within dedicated trough/gallery' }, { value: 'direct_attach', text: 'Directly Welded/Bolted to Bridge Members' },
                    { value: 'u_bolts', text: 'U-Bolts' }, { value: 'sleeved_cased_abutment_deck', text: 'Sleeved/Cased through Abutment/Deck' },
                    { value: 'guides', text: 'Guides (Restrict lateral movement)' }, { value: 'anchors', text: 'Anchors (Restrict all movement)' },
                    { value: 'other_support', text: 'Other' }
                ]
            },
            { label: 'Specify Other Support Method:', id: 'other-support-specify', type: 'textarea', placeholder: 'Describe other support method' },
            {
                label: 'Observed Condition of Supports/Anchors in Relation to Thermal Stress:', id: 'support-condition-thermal-stress', type: 'select',
                options: [
                    { value: '', text: 'Select Condition...' }, { value: 'no_stress_damage', text: 'No visible stress/damage' },
                    { value: 'minor_stress_wear', text: 'Minor stress/wear' }, { value: 'significant_stress_damage', text: 'Significant stress/damage' },
                    { value: 'unable_to_assess_support_stress', text: 'Unable to Assess' }
                ]
            },
            { label: 'Comments on Support Condition (Thermal Stress):', id: 'support-condition-thermal-stress-comments', type: 'textarea', placeholder: 'Detail observations...' },
            {
                label: 'Evidence of Unintended Pipe Movement or Restriction at Supports:', id: 'pipe-movement-at-supports', type: 'select',
                options: [
                    { value: '', text: 'Select Observation...' }, { value: 'correctly_positioned', text: 'Pipe appears correctly positioned' },
                    { value: 'shifted', text: 'Pipe visibly shifted' }, { value: 'hard_against_guides', text: 'Pipe hard against guide stops' },
                    { value: 'rubbing_fretting', text: 'Evidence of excessive rubbing/fretting' }, { value: 'disengaged', text: 'Pipe disengaged from support(s)' },
                    { value: 'unable_to_assess_pipe_movement', text: 'Unable to Assess' }
                ]
            },
            { label: 'Comments on Pipe Movement/Restriction at Supports:', id: 'pipe-movement-at-supports-comments', type: 'textarea', placeholder: 'Detail observations...' },
            {
                label: 'For Sliding Supports or Rollers: Functionality Assessment', id: 'sliding-roller-functionality', type: 'select',
                options: [
                    { value: '', text: 'Select Functionality...' }, { value: 'functional_free_move', text: 'Appears functional / free to move' },
                    { value: 'signs_binding_seizure', text: 'Signs of binding / seizure / corrosion' }, { value: 'obstructed_debris_components', text: 'Obstructed by debris/components' },
                    { value: 'na_no_sliding_roller', text: 'Not Applicable' }, { value: 'unable_to_assess_functionality', text: 'Unable to Assess' }
                ]
            },
            { label: 'Comments on Sliding/Roller Support Functionality:', id: 'sliding-roller-functionality-comments', type: 'textarea', placeholder: 'Detail observations...' },
            { label: 'Comments on Pipeline Support & Attachment (General):', id: 'support-comments', type: 'textarea', placeholder: 'General observations about supports, attachments, etc.' }
        ]
    },
    {
        title: 'Thermal Expansion & Movement Accommodation',
        id: 'section-pipeline-expansion',
        fields: [
            {
                label: 'Expansion/Contraction Accommodation Feature(s):', id: 'pipeline-expansion-features', type: 'checkbox-group',
                checkboxOptions: [
                    { value: 'expansion_loops', text: 'Expansion Loops (U-bends or L-bends)' }, { value: 'expansion_joints', text: 'Expansion Joints (bellows, slip-type)' },
                    { value: 'flexible_connectors', text: 'Flexible Connectors/Hoses' }, { value: 'designed_slack', text: 'Designed Slack or Offsets' },
                    { value: 'none_observed', text: 'None Observed' }, { value: 'unable_to_determine', text: 'Unable to Determine' },
                    { value: 'other_expansion', text: 'Other' }
                ]
            },
            { label: 'Specify Other Expansion Feature:', id: 'other-expansion-specify', type: 'textarea', placeholder: 'Describe other expansion feature' },
            {
                label: 'Observed Functionality of Expansion Joints/Loops (if present):', id: 'expansion-feature-functionality', type: 'select',
                options: [
                    { value: '', text: 'Select Functionality...' }, { value: 'functional_good_condition', text: 'Functional and in good condition' },
                    { value: 'seized_stuck', text: 'Signs of being seized/stuck' }, { value: 'leaking', text: 'Leaking (if applicable)' },
                    { value: 'over_extended_compressed', text: 'Visibly over-extended/compressed' }, { value: 'damaged_components', text: 'Damaged components' },
                    { value: 'na_expansion_feature', text: 'Not Applicable' }, { value: 'unable_to_assess_expansion_functionality', text: 'Unable to Assess' }
                ]
            },
            { label: 'Comments on Expansion Feature Functionality:', id: 'expansion-feature-functionality-comments', type: 'textarea', placeholder: 'Detail observations...' },
            { label: 'Comments on Expansion/Contraction Accommodation (General):', id: 'expansion-comments', type: 'textarea', placeholder: 'General observations on expansion features.' }
        ]
    },
    {
        title: 'Pipeline Condition & Coating Assessment',
        id: 'section-pipeline-condition',
        fields: [
            {
                label: 'Visible External Corrosion:', id: 'external-corrosion', type: 'select', required: true,
                options: [
                    { value: '', text: 'Select Corrosion Level...' }, { value: 'none', text: 'No Visible External Corrosion' },
                    { value: 'minor', text: 'Minor Surface Corrosion / Discoloration' }, { value: 'moderate', text: 'Moderate Corrosion' },
                    { value: 'severe', text: 'Severe Corrosion' }, { value: 'unable_to_assess', text: 'Unable to Assess' }
                ]
            },
            {
                label: 'Coating Type:', id: 'coating-type', type: 'select',
                options: [ 
                    { value: '', text: 'Select Coating Type...' }, { value: 'fbe', text: 'FBE' },
                    { value: 'wax_tape', text: 'Wax Tape' }, { value: 'pritech', text: 'Pritech' },
                    { value: 'x_tru_coat', text: 'X-Tru-Coat' }, { value: 'other_coating', text: 'Other' }
                ],
                defaultValue: '' 
            },
            { label: 'Specify Other Coating Type:', id: 'other-coating-type-specify', type: 'textarea', placeholder: 'Describe other coating type' },
            {
                label: 'Visible Coating Condition:', id: 'coating-condition', type: 'select',
                options: [
                    { value: '', text: 'Select Coating Condition...' }, { value: 'good', text: 'Good (Intact, well-adhered)' },
                    { value: 'fair', text: 'Fair (Minor abrasions/scratches)' }, { value: 'poor', text: 'Poor (Damage, disbondment, peeling)' },
                    { value: 'unable_to_assess_coating_condition', text: 'Unable to Assess' }
                ]
            },
            { label: 'Comments on Coating:', id: 'coating-comments', type: 'textarea', placeholder: 'Specific observations about pipeline coating.' },
            {
                label: 'Test Station Found and Accessible?', id: 'test-station-accessible', type: 'select',
                options: [ { value: '', text: 'Select...' }, { value: 'yes', text: 'Yes' }, { value: 'no', text: 'No' }, { value: 'na', text: 'Not Applicable' }]
            },
            { label: 'Pipe-to-Soil Potential Reading (mV):', id: 'pipe-to-soil-potential', type: 'number', placeholder: 'e.g., -950' },
            { label: 'Comments on Cathodic Protection:', id: 'cp-comments', type: 'textarea', placeholder: 'e.g., Location, type, condition of test station. Insulator condition.' },
            { label: 'Evidence of Physical Damage to Pipe (dents, gouges, etc.):', id: 'pipe-physical-damage', type: 'textarea', placeholder: 'Describe any physical damage observed.' },
            { label: 'Atmospheric Corrosion: Extent and Severity (if steel pipe exposed):', id: 'atmospheric-corrosion-details', type: 'textarea', placeholder: 'Describe atmospheric corrosion details.' }
        ]
    },
    {
        title: 'Pipe Clearances & Measurements',
        id: 'section-clearances',
        fields: [
            { label: 'Vertical Clearance - Pipe to Bridge Deck/Structure Above (ft):', id: 'clearance-vertical-above', type: 'number', placeholder: 'e.g., 2.5', assessmentOptions: ["Measured", "Estimated", "Could not Assess"] },
            { label: 'Vertical Clearance - Pipe to Water/Ground/Obstruction Below (ft):', id: 'clearance-vertical-below', type: 'number', placeholder: 'e.g., 10.0', assessmentOptions: ["Measured", "Estimated", "Could not Assess"] },
            { label: 'Horizontal Clearance - Pipe to Bridge Abutment/Pier (ft):', id: 'clearance-horizontal-abutment', type: 'number', placeholder: 'e.g., 1.0', assessmentOptions: ["Measured", "Estimated", "Could not Assess"] },
            { label: 'Horizontal Clearance - Pipe to other Utilities/Structures (ft):', id: 'clearance-horizontal-other', type: 'number', placeholder: 'e.g., 3.0', assessmentOptions: ["Measured", "Estimated", "Could not Assess"] },
            { label: 'Comments on Clearances and Measurements:', id: 'clearance-comments', type: 'textarea', placeholder: 'Any specific observations or concerns about clearances.' }
        ]
    },
    {
        title: 'Access & Safety',
        id: 'section-access-safety',
        fields: [
            { label: 'Accessibility for Inspection/Maintenance:', id: 'accessibility-inspection', type: 'select', options: [{value: '', text: 'Select...'}, {value: 'good', text: 'Good'}, {value: 'fair', text: 'Fair'}, {value: 'poor', text: 'Poor (requires special equipment/permits)'}, {value: 'restricted', text: 'Restricted/Hazardous'}]},
            { label: 'Safety Hazards Noted (e.g., traffic, fall hazards, confined space):', id: 'safety-hazards', type: 'textarea', placeholder: 'Describe any safety hazards.' },
            { label: 'Condition of Access Structures (ladders, walkways, etc.):', id: 'access-structures-condition', type: 'textarea', placeholder: 'Describe condition if applicable.' },
            { label: 'Comments on Access & Safety:', id: 'access-safety-comments', type: 'textarea', placeholder: 'Other access or safety related observations.' }
        ]
    },
    {
        title: 'Photographs & Attachments',
        id: 'section-photos',
        fields: [
            { label: 'Photographs Taken (list or describe):', id: 'photographs-taken', type: 'textarea', placeholder: 'e.g., Overall crossing, support details, coating damage, clearance issues.' },
            { label: 'Installation Records (Images Only):', id: 'installation-records', type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/tiff' },
            { label: 'Upload Photographs/Sketches:', id: 'file-attachments', type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/tiff' }
        ]
    },
    {
        title: 'Third-Party Infrastructure & Proximity',
        id: 'section-third-party',
        fields: [
            { label: 'Other Utilities or Structures Attached to/Near Bridge:', id: 'other-utilities-bridge', type: 'textarea', placeholder: 'Describe type and proximity (e.g., electrical conduits, telecom cables, water lines).' },
            { label: 'Observed Condition of Bridge Structure (General):', id: 'bridge-structure-condition', type: 'textarea', placeholder: 'General observations on bridge condition (e.g., spalling concrete, rust on steel members, deck condition).' },
            { label: 'Potential for Third-Party Damage to Pipeline:', id: 'third-party-damage-potential', type: 'textarea', placeholder: 'Describe any activities or conditions that could pose a risk.' },
            { label: 'Comments on Third-Party Infrastructure:', id: 'third-party-comments', type: 'textarea', placeholder: 'Additional observations.' }
        ]
    },
    {
        title: 'Immediate Hazards or Concerns Noted',
        id: 'section-hazards',
        fields: [
            { label: 'Any Immediate Hazards Identified (requiring urgent attention):', id: 'immediate-hazards', type: 'textarea', placeholder: 'Describe any severe corrosion, critical support failure, leaks, imminent third-party damage risk, etc.' },
            { label: 'Actions Taken/Notification Made (if any immediate hazards):', id: 'actions-taken-hazards', type: 'textarea', placeholder: 'Detail actions or notifications.' }
        ]
    },
    {
        title: 'Recommendations',
        id: 'section-recommendations',
        fields: [
            {
                label: 'Recommended Actions:',
                id: 'recommendation-actions',
                type: 'radio-group',
                checkboxOptions: [ 
                    { value: 'no_action', text: 'No immediate action required - Continue routine monitoring.' },
                    { value: 'monitor_re_evaluate', text: 'Monitor specific concern(s) and re-evaluate in [X] months/years.' },
                    { value: 'further_inspection_ndt', text: 'Further detailed inspection required (e.g., NDT, coating survey).' },
                    { value: 'coating_repair', text: 'Coating repair needed.' },
                    { value: 'support_repair_adjustment', text: 'Pipeline support repair or adjustment required.' },
                    { value: 'vegetation_management', text: 'Vegetation management required.' },
                    { value: 'debris_removal', text: 'Debris removal around pipe/supports required.' },
                    { value: 'address_clearance', text: 'Address clearance issue(s).' },
                    { value: 'address_access_safety', text: 'Address access/safety concern(s).' },
                    { value: 'consult_structural_engineer', text: 'Consult with bridge owner / structural engineer regarding bridge condition.' },
                    { value: 'other_recommendation', text: 'Other (Specify in summary)' }
                ]
            },
             {
                label: 'Recommendation Priority:', id: 'recommendation-priority', type: 'select', required: true,
                options: [
                    { value: '', text: 'Select Priority...' }, { value: 'immediate', text: 'Immediate (Within 7 days)' },
                    { value: 'high', text: 'High (Within 30 days)' }, { value: 'medium', text: 'Medium (Within 90 days)' },
                    { value: 'low', text: 'Low (Within 1 year)' }, { value: 'monitor', text: 'Monitor (Next scheduled inspection)' }
                ]
            },
            { label: 'Summary of Recommendations / Specify "Other" / Timeline:', id: 'recommendations-summary', type: 'textarea', placeholder: 'Detail the recommended actions, specify if "Other" was selected, and provide timeline for actions.' },
            { label: 'Final Summary of Evaluation:', id: 'final-summary-evaluation', type: 'textarea', placeholder: 'Provide an overall summary of the pipeline crossing condition and assessment findings.' }
        ]
    }
];


function renderForm() {
    const form = document.getElementById('assessment-form') as HTMLFormElement;
    if (!form) {
        console.error('Assessment form element not found!');
        return;
    }
    form.innerHTML = ''; // Clear previous form content if any

    allFormSections.forEach((sectionData, index) => {
        form.appendChild(createSectionElement(sectionData.title, sectionData.id, sectionData.fields, index + 1));
    });
}


function populateProcessGuidelines() {
    const container = document.getElementById('process-guidelines-container');
    if (!container) return;

    container.innerHTML = `
        <h2>Pipeline Bridge Crossing Assessment: Process Guidelines</h2>
        <p>This document outlines the standard process for conducting a natural gas pipeline bridge crossing assessment using the provided form. Adherence to these guidelines ensures comprehensive and consistent evaluations.</p>
        
        <h3>I. Pre-Assessment Preparation</h3>
        <ul>
            <li><strong>Review Documentation:</strong> Gather and review existing records for the crossing. This includes as-built drawings, previous inspection reports, MAOP records, material specifications, and any history of repairs or issues.</li>
            <li><strong>Tools & Equipment:</strong> Ensure all necessary tools and equipment are available and in good working order. This may include:
                <ul>
                    <li>Personal Protective Equipment (PPE) as required (hard hat, safety glasses, gloves, high-visibility vest, safety footwear).</li>
                    <li>Measurement tools (tape measure, calipers, depth gauge for corrosion if applicable).</li>
                    <li>Camera for photographic documentation.</li>
                    <li>Flashlight or headlamp for poorly lit areas.</li>
                    <li>Binoculars for inspecting hard-to-reach areas.</li>
                    <li>Coating holiday detector (if required and trained).</li>
                    <li>GPS device or smartphone with GPS capabilities.</li>
                    <li>This assessment form (digital or printed).</li>
                    <li>Note-taking materials.</li>
                </ul>
            </li>
            <li><strong>Site Access & Permissions:</strong> Confirm access permissions to the bridge and surrounding areas. Coordinate with bridge owners (e.g., DOT, railway) or property owners if necessary. Identify any specific access procedures or safety requirements for the location.</li>
            <li><strong>Safety Briefing:</strong> Conduct or attend a pre-job safety briefing to discuss potential hazards (traffic, working at heights, environmental conditions, wildlife, etc.) and mitigation measures. Ensure emergency contact information is available.</li>
        </ul>

        <h3>II. On-Site Assessment (Corresponds to Form Sections)</h3>
        
        <h4>Section 1: General Site & Crossing Information</h4>
        <ul>
            <li>Accurately record the date of assessment and the name(s) of the assessor(s).</li>
            <li>Select the correct District Operating Center (DOC) from the dropdown list.</li>
            <li>Provide a detailed description of the crossing and work location, including landmarks, access points, and any initial visual observations that help identify the specific site.</li>
            <li>Record the unique Crossing Identification Number. If not available, consult records or assign as per company procedure.</li>
            <li>Document the Bridge Name and Bridge Number (if available from bridge owner or signage).</li>
            <li>Record the Road Name that utilizes the bridge and the Feature Crossed (e.g., river name, highway number, railway line).</li>
            <li>Obtain and record accurate GPS Latitude and Longitude coordinates for the pipeline crossing, preferably at the approximate center or a defined reference point on the crossing.</li>
        </ul>

        <h4>Section 2: Pipeline Identification & Specifications</h4>
        <ul>
            <li>Identify and record the pipeline material (e.g., Steel Pipe, Steel Pipe in casing, Plastic pipe in casing).</li>
            <li>Select the nominal Pipeline Diameter. If "Other," specify the diameter in the provided text field.</li>
            <li>Record the Pipe Wall Thickness and select the method used to determine it (e.g., Measured, from Records).</li>
            <li>Enter the estimated or known Installation Temperature in degrees Fahrenheit and select how this value was determined (e.g., Assumed, from Records, from historical data).</li>
            <li>If the DOC selected has predefined systems (e.g., "Northern Utilities - Maine," "Northern Utilities - New Hampshire," "FG&E"), select the appropriate system from its specific dropdown. This will auto-populate the MAOP.</li>
            <li>For other DOCs, or if overriding, manually select the unit for Maximum Allowable Operating Pressure (MAOP) (PSIG or inches W.C.).</li>
            <li>For other DOCs, or if overriding, manually record the MAOP Value.</li>
        </ul>

        <h4>Section 3: Pipeline Support & Anchorage System</h4>
        <ul>
            <li>Carefully observe and select all applicable pipeline support methods used at the crossing.</li>
            <li>If "Other" support method is selected, provide a specific description.</li>
            <li>Assess the condition of supports and anchors, specifically looking for signs of stress or damage due to thermal expansion/contraction of the pipe or bridge. Select the appropriate condition.</li>
            <li>Provide detailed comments on any observed stress or damage related to thermal effects on supports.</li>
            <li>Look for evidence of unintended pipe movement (e.g., pipe shifted off supports, excessive gaps, wear marks) or restriction (e.g., pipe binding against supports). Select the observed condition.</li>
            <li>Comment on any observed pipe movement or restriction, detailing locations and severity.</li>
            <li>If sliding supports or rollers are present, assess their functionality. Check for freedom of movement, signs of binding, corrosion, or obstruction. Select the appropriate functionality.</li>
            <li>Provide comments on the functionality of sliding/roller supports.</li>
            <li>Include general comments on the overall condition, adequacy, and any concerns related to the pipeline support and attachment system.</li>
        </ul>

        <h4>Section 4: Thermal Expansion & Movement Accommodation</h4>
        <ul>
            <li>Identify any features designed to accommodate thermal expansion/contraction of the pipeline (e.g., expansion loops, expansion joints, flexible connectors, designed slack). Select all applicable features.</li>
            <li>If "Other" expansion feature is selected, provide a specific description.</li>
            <li>If expansion joints or loops are present, assess their observed functionality and condition (e.g., functional, seized, leaking, damaged). Select the appropriate condition.</li>
            <li>Comment on the functionality and condition of any expansion features.</li>
            <li>Provide general comments on the overall system for accommodating thermal expansion and contraction.</li>
        </ul>

        <h4>Section 5: Pipeline Condition & Coating Assessment</h4>
        <ul>
            <li>Visually inspect all accessible portions of the pipeline for external corrosion. Characterize the level of corrosion observed.</li>
            <li>Identify and select the pipeline Coating Type. If "Other," specify the type.</li>
            <li>Assess the visible condition of the pipeline coating (e.g., good, fair, poor with damage/disbondment). Select the appropriate condition.</li>
            <li>Provide detailed comments on the coating, including locations of damage, type of damage (e.g., abrasion, disbondment, blistering), and estimated area affected.</li>
            <li>Determine if Monolithic Insulator(s) are present. If yes, provide details on their location, type, visible condition, and any available test station readings.</li>
            <li>Describe any observed physical damage to the pipe itself (e.g., dents, gouges, scrapes), noting location and approximate dimensions.</li>
            <li>If steel pipe is exposed to the atmosphere, describe the extent and severity of any atmospheric corrosion.</li>
        </ul>

        <h4>Section 6: Pipe Clearances & Measurements</h4>
        <ul>
            <li>Measure and record critical clearances using the specified units (feet). For each measurement, indicate if it was "Measured," "Estimated," or "Could not Assess."
                <ul>
                    <li>Vertical Clearance from the pipe to the bridge deck or structure above.</li>
                    <li>Vertical Clearance from the pipe to the water surface, ground, or any obstruction below.</li>
                    <li>Horizontal Clearance from the pipe to bridge abutments or piers.</li>
                    <li>Horizontal Clearance from the pipe to other utilities or structures.</li>
                </ul>
            </li>
            <li>Provide comments on any clearance issues or concerns (e.g., insufficient clearance, potential for contact).</li>
        </ul>

        <h4>Section 7: Environmental Considerations</h4>
        <ul>
            <li>Observe and describe vegetation growth around the pipeline and its supports. Note if vegetation is overgrown, in contact with the pipe/coating, or if tree roots pose a threat.</li>
            <li>Look for and describe any evidence of scour (erosion of soil/sediment) around pipeline supports or abutments, or erosion along banks near the pipeline.</li>
            <li>Describe the pipeline's proximity to any water bodies or wetlands and any potential impact or risk (e.g., immersion, susceptibility to flooding).</li>
            <li>Note any accumulation of debris (e.g., branches, trash, sediment) around the pipeline or supports that could impede inspection, restrict movement, or damage the coating.</li>
            <li>Provide general comments on any other environmental conditions or concerns relevant to the pipeline crossing.</li>
        </ul>

        <h4>Section 8: Access & Safety</h4>
        <ul>
            <li>Assess the overall accessibility of the pipeline crossing for routine inspection and potential maintenance activities. Select the appropriate level of accessibility.</li>
            <li>Identify and describe any safety hazards noted at the site (e.g., high-speed traffic, fall hazards, confined spaces, unstable ground, presence of hazardous materials).</li>
            <li>If specific access structures (e.g., ladders, walkways, platforms) are present for the pipeline, describe their condition.</li>
            <li>Provide general comments on any other access or safety-related observations or concerns.</li>
        </ul>

        <h4>Section 9: Photographs & Attachments</h4>
        <ul>
            <li>Keep a log or list key photographs taken during the assessment. Photos should document:
                <ul>
                    <li>Overall views of the crossing from different angles.</li>
                    <li>Specific details of pipeline supports, anchors, and expansion features.</li>
                    <li>Any observed corrosion, coating damage, or physical damage.</li>
                    <li>Clearance issues.</li>
                    <li>Environmental concerns (e.g., scour, vegetation).</li>
                    <li>Access points and any safety hazards.</li>
                </ul>
            </li>
            <li>Utilize the file upload feature to attach relevant photographs, sketches, or other supporting documents. Ensure file names are descriptive if possible.</li>
            <li>For each file uploaded, add a concise, descriptive comment in the provided text box.</li>
        </ul>

        <h4>Section 10: Third-Party Infrastructure & Proximity</h4>
        <ul>
            <li>Identify and describe any other utilities (e.g., electrical conduits, telecom cables, water lines) or structures attached to or located near the bridge and in proximity to the pipeline. Note their type and relative location.</li>
            <li>Provide general observations on the apparent condition of the bridge structure itself (e.g., spalling concrete, rust on steel members, condition of bridge deck or Expansion joints). This is a cursory observation, not a structural bridge inspection.</li>
            <li>Describe any activities or conditions observed that could pose a potential risk of third-party damage to the pipeline (e.g., construction activity, heavy equipment movement, vandalism).</li>
            <li>Provide additional comments on third-party infrastructure or related concerns.</li>
        </ul>

        <h4>Section 11: Immediate Hazards or Concerns Noted</h4>
        <ul>
            <li>Document any immediate hazards identified that require urgent attention. This could include severe corrosion with potential for leakage, critical support failure, observed leaks (gas or other), imminent risk of third-party damage, or any condition that poses an immediate threat to pipeline integrity or public safety.</li>
            <li>If any immediate hazards are identified, describe any actions taken on-site (e.g., notifying supervisor, contacting emergency services, isolating an area if safe to do so) or notifications made.</li>
        </ul>

        <h4>Section 12: Recommendations</h4>
        <ul>
            <li>Based on the overall assessment findings, select the most appropriate recommended action(s) from the provided radio button list.</li>
            <li>In the "Summary of Recommendations" textarea, elaborate on the selected recommendation(s). If "Other" was chosen, provide specific details here. Include any suggested timelines for actions if applicable. This summary should clearly articulate what needs to be done, why, and potentially by when.</li>
            <li>Provide a "Final Summary of Evaluation." This should be a concise overview of the pipeline crossing's condition, highlighting key findings, overall risk assessment (qualitative), and the justification for the recommendations.</li>
        </ul>

        <h3>III. Post-Assessment</h3>
        <ul>
            <li><strong>Review Form:</strong> Before submitting, review the entire form for completeness, accuracy, and clarity. Ensure all required fields are filled and comments are descriptive.</li>
            <li><strong>Submit Report:</strong> Submit the completed assessment form and all attachments (photos, sketches) according to company procedures.</li>
            <li><strong>Follow-Up:</strong> Ensure any identified immediate hazards are appropriately escalated and addressed. Track the progress of other recommendations as required.</li>
        </ul>

        <h3>IV. Safety Considerations</h3>
        <ul>
            <li>Always prioritize safety. Do not perform any task that you feel is unsafe.</li>
            <li>Be aware of your surroundings at all times, especially regarding traffic, water hazards, and weather conditions.</li>
            <li>Use appropriate PPE.</li>
            <li>If working alone, ensure you have a check-in procedure.</li>
            <li>Do not enter confined spaces unless trained, authorized, and all safety procedures are followed.</li>
            <li>Report any incidents or near misses.</li>
        </ul>
    `;
}


function setupTabs() {
    const tabForm = document.getElementById('tab-form');
    const tabProcess = document.getElementById('tab-process');
    const formContainer = document.getElementById('assessment-form-container');
    const processContainer = document.getElementById('process-guidelines-container');

    if (!tabForm || !tabProcess || !formContainer || !processContainer) {
        console.error('Tab elements or containers not found!');
        return;
    }

    tabForm.addEventListener('click', () => {
        if (formContainer) formContainer.style.display = 'block';
        if (processContainer) processContainer.style.display = 'none';
        tabForm.classList.add('active');
        tabForm.setAttribute('aria-selected', 'true');
        tabProcess.classList.remove('active');
        tabProcess.setAttribute('aria-selected', 'false');
    });

    tabProcess.addEventListener('click', () => {
        if (formContainer) formContainer.style.display = 'none';
        if (processContainer) processContainer.style.display = 'block';
        tabProcess.classList.add('active');
        tabProcess.setAttribute('aria-selected', 'true');
        tabForm.classList.remove('active');
        tabForm.setAttribute('aria-selected', 'false');
    });
}

function collectFormData(): Record<string, any> {
    const formData: Record<string, any> = {};
    const form = document.getElementById('assessment-form') as HTMLFormElement;
    if (!form) return formData;

    const elements = form.elements;
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const key = element.id || element.name;
        if (!key) continue; // Skip elements without name or id

        if (element.type === 'checkbox') {
            formData[key] = (element as HTMLInputElement).checked;
        } else if (element.type === 'radio') {
            if ((element as HTMLInputElement).checked) {
                formData[element.name] = (element as HTMLInputElement).value;
            }
        } else if (element.type === 'file') {
            // Read directly from the central data store
            formData[key] = fileDataStore[key] || [];
        } else if (element.tagName === 'SELECT') {
             formData[key] = (element as HTMLSelectElement).value;
        }
        else {
            formData[key] = element.value;
        }
    }
    return formData;
}

function populateFormWithData(data: Record<string, any>) {
    const form = document.getElementById('assessment-form') as HTMLFormElement;
    if (!form) return;
    
    // Reset form and clear file store before populating
    form.reset();
    Object.keys(fileDataStore).forEach(key => {
        fileDataStore[key] = [];
        renderFileList(key);
    });

    Object.keys(data).forEach(key => {
        const element = document.getElementById(key) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (element) {
            if (element.type === 'file') {
                const fileData = data[key] as FileWithComment[];
                if (Array.isArray(fileData)) {
                    // Populate the store and render the list
                    fileDataStore[key] = fileData;
                    renderFileList(key);
                }
                // Clear the actual file input element's value
                element.value = '';
            } else if (element.type === 'checkbox') {
                (element as HTMLInputElement).checked = data[key];
            } else if (element.tagName === 'SELECT') {
                 (element as HTMLSelectElement).value = data[key];
                 if (key === 'doc-center') {
                     element.dispatchEvent(new Event('change')); // This will trigger setupDocDependentFields logic
                     // Now handle the dependent system selects
                     const selectedDocValue = data['doc-center'];
                     let systemSelectId: string | null = null;
                     if (selectedDocValue === 'bng' && data['bng-system-select']) {
                         systemSelectId = 'bng-system-select';
                     } else if (selectedDocValue === 'nu_me' && data['nu-me-system-select']) {
                         systemSelectId = 'nu-me-system-select';
                     } else if (selectedDocValue === 'nu_nh' && data['nu-nh-system-select']) {
                         systemSelectId = 'nu-nh-system-select';
                     } else if (selectedDocValue === 'fge' && data['fge-system-select']) {
                        systemSelectId = 'fge-system-select';
                     }

                     if (systemSelectId) {
                        const systemSelectValue = data[systemSelectId];
                        // setTimeout to allow the system select to be populated by the 'doc-center' change handler
                        setTimeout(() => {
                            const systemSelectElement = document.getElementById(systemSelectId!) as HTMLSelectElement;
                            if (systemSelectElement) {
                                systemSelectElement.value = systemSelectValue;
                                systemSelectElement.dispatchEvent(new Event('change')); // Trigger MAOP update
                            }
                        }, 0); // Small delay to ensure dropdown is populated.
                     }
                 }
            } else if (element.type !== 'radio') { 
                element.value = data[key];
            }
        } else {
            const radioElements = form.elements.namedItem(key);
            if (radioElements instanceof RadioNodeList) {
                for (let i = 0; i < radioElements.length; i++) {
                    const radio = radioElements[i] as HTMLInputElement;
                    if (radio.value === data[key]) {
                        radio.checked = true;
                        break;
                    }
                }
            }
        }
    });
    
    // Auto-resize all textareas after populating them
    document.querySelectorAll('textarea').forEach(textarea => {
        autoResizeTextarea(textarea);
    });

    alert('Assessment data loaded successfully!');
}


function handleSaveAssessment() {
    const data = collectFormData();
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const crossingIdElement = document.getElementById('crossing-id') as HTMLInputElement;
    const crossingId = crossingIdElement ? crossingIdElement.value.replace(/[^a-z0-9]/gi, '_') : 'assessment';
    a.download = `pipeline_assessment_${crossingId || 'data'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('Assessment data saved!');
}

function handleOpenAssessment() {
    const fileInput = document.getElementById('open-file-input') as HTMLInputElement;
    if (fileInput) {
        fileInput.click();
    }
}

function setupDocDependentFields() {
    const docCenterSelect = document.getElementById('doc-center') as HTMLSelectElement;
    const maopValueInput = document.getElementById('maop-value') as HTMLInputElement;
    const maopUnitSelect = document.getElementById('maop-unit') as HTMLSelectElement;

    const systemSelects = {
        'bng': {
            container: document.getElementById('bng-system-select-container'),
            select: document.getElementById('bng-system-select') as HTMLSelectElement,
            data: bngSystems,
            placeholder: 'Select System for Bangor Natural Gas...'
        },
        'nu_me': {
            container: document.getElementById('nu-me-system-select-container'),
            select: document.getElementById('nu-me-system-select') as HTMLSelectElement,
            data: nuMeSystems,
            placeholder: 'Select System for NU Maine...'
        },
        'nu_nh': {
            container: document.getElementById('nu-nh-system-select-container'),
            select: document.getElementById('nu-nh-system-select') as HTMLSelectElement,
            data: nuNhSystems,
            placeholder: 'Select System for NU New Hampshire...'
        },
        'fge': {
            container: document.getElementById('fge-system-select-container'),
            select: document.getElementById('fge-system-select') as HTMLSelectElement,
            data: fgAndESystems,
            placeholder: 'Select System for FG&E...'
        }
    };

    if (!docCenterSelect || !maopValueInput || !maopUnitSelect ||
        !systemSelects.bng.container || !systemSelects.bng.select ||
        !systemSelects.nu_me.container || !systemSelects.nu_me.select ||
        !systemSelects.nu_nh.container || !systemSelects.nu_nh.select ||
        !systemSelects.fge.container || !systemSelects.fge.select) {
        console.error('One or more elements for DOC dependent fields are missing.');
        return;
    }

    const populateSystemDropdown = (config: typeof systemSelects[keyof typeof systemSelects]) => {
        config.select.innerHTML = ''; // Clear existing options
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.text = config.placeholder;
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        config.select.appendChild(placeholderOption);

        config.data.forEach((system) => {
            const option = document.createElement('option');
            option.value = system.originalIndex.toString(); // Use originalIndex as value
            option.text = system.displayText;
            config.select.appendChild(option);
        });
    };

    const clearMaopFields = () => {
        maopValueInput.value = '';
        maopUnitSelect.value = '';
        if (maopUnitSelect.options.length > 0) maopUnitSelect.selectedIndex = 0;
    };
    
    const handleDocChange = () => {
        const selectedDoc = docCenterSelect.value as keyof typeof systemSelects | '';
        clearMaopFields();

        // Hide all system select containers first
        Object.values(systemSelects).forEach(s => {
            if (s.container) s.container.style.display = 'none';
            if (s.select) s.select.value = '';
        });

        if (selectedDoc && systemSelects[selectedDoc]) {
            const currentSystem = systemSelects[selectedDoc];
            if (currentSystem.container) currentSystem.container.style.display = 'block';
            populateSystemDropdown(currentSystem);
        }
    };

    const createSystemSelectChangeHandler = (config: typeof systemSelects[keyof typeof systemSelects]) => {
        return () => {
            const selectedIndexStr = config.select.value;
            if (selectedIndexStr && selectedIndexStr !== '') {
                const selectedIndex = parseInt(selectedIndexStr, 10);
                const system = config.data.find(s => s.originalIndex === selectedIndex);
                if (system) {
                    maopValueInput.value = system.maopValue.toString();
                    maopUnitSelect.value = system.maopUnit;
                }
            } else {
                clearMaopFields();
            }
        };
    };

    docCenterSelect.addEventListener('change', handleDocChange);
    systemSelects.bng.select.addEventListener('change', createSystemSelectChangeHandler(systemSelects.bng));
    systemSelects.nu_me.select.addEventListener('change', createSystemSelectChangeHandler(systemSelects.nu_me));
    systemSelects.nu_nh.select.addEventListener('change', createSystemSelectChangeHandler(systemSelects.nu_nh));
    systemSelects.fge.select.addEventListener('change', createSystemSelectChangeHandler(systemSelects.fge));

    handleDocChange(); // Initial setup
}

interface ReportFieldDetail {
    section: string;
    label: string;
    value: string; // User-friendly text representation
}

function getElementValue(id: string): string {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    return el ? el.value : 'N/A';
}

function getSelectedOptionText(selectId: string): string {
    const select = document.getElementById(selectId) as HTMLSelectElement;
    if (select && select.selectedIndex >= 0 && select.options[select.selectedIndex]) {
        return select.options[select.selectedIndex].text || 'N/A';
    }
    return 'N/A';
}

function collectReportData(): ReportFieldDetail[] {
    const reportData: ReportFieldDetail[] = [];

    allFormSections.forEach(section => {
        section.fields.forEach(field => {
            const element = document.getElementById(field.id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            let displayValue = 'N/A';

            if (element) {
                switch (field.type) {
                    case 'date': {
                        const rawDate = element.value; // YYYY-MM-DD
                        if (rawDate) {
                            const [year, month, day] = rawDate.split('-');
                            displayValue = `${month}/${day}/${year}`;
                        }
                        break;
                    }
                    case 'select':
                        displayValue = getSelectedOptionText(field.id);
                        if (field.id === 'doc-center' && (element as HTMLSelectElement).value) {
                             // Also capture specific system if selected
                            const docVal = (element as HTMLSelectElement).value;
                            let systemSelectId: string | null = null;
                            if (docVal === 'bng') systemSelectId = 'bng-system-select';
                            else if (docVal === 'nu_me') systemSelectId = 'nu-me-system-select';
                            else if (docVal === 'nu_nh') systemSelectId = 'nu-nh-system-select';
                            else if (docVal === 'fge') systemSelectId = 'fge-system-select';

                            if (systemSelectId) {
                                const systemSelectEl = document.getElementById(systemSelectId) as HTMLSelectElement;
                                if (systemSelectEl && systemSelectEl.value !== '') {
                                    reportData.push({
                                        section: section.title,
                                        label: systemSelectEl.labels?.[0]?.textContent || (systemSelectEl.previousElementSibling as HTMLLabelElement)?.textContent || systemSelectEl.id,
                                        value: getSelectedOptionText(systemSelectId)
                                    });
                                }
                            }
                        }
                        break;
                    case 'checkbox-group': {
                        const checkedItems: string[] = [];
                        field.checkboxOptions?.forEach(opt => {
                            const chkId = `${field.id}-${opt.value.toLowerCase().replace(/\s+/g, '-')}`;
                            const chk = document.getElementById(chkId) as HTMLInputElement;
                            if (chk && chk.checked) {
                                checkedItems.push(opt.text);
                            }
                        });
                        displayValue = checkedItems.length > 0 ? checkedItems.join(', ') : 'None selected';
                        break;
                    }
                    case 'radio-group': {
                        const radioName = field.id;
                        const checkedRadio = document.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement;
                        if (checkedRadio) {
                            const radioLabel = document.querySelector(`label[for="${checkedRadio.id}"]`);
                            displayValue = radioLabel?.textContent || checkedRadio.value;
                        } else {
                            displayValue = 'None selected';
                        }
                        break;
                    }
                    case 'file': {
                        const files = fileDataStore[field.id] || [];
                        if (files.length > 0) {
                            displayValue = "See attached photographs in report.";
                        } else {
                            displayValue = "No files attached.";
                        }
                        break;
                    }
                    case 'number':
                        displayValue = element.value || 'N/A';
                        if (field.assessmentOptions) {
                            const assessmentRadioName = `${field.id}-assessment-type`;
                            const checkedAssessmentRadio = document.querySelector(`input[name="${assessmentRadioName}"]:checked`) as HTMLInputElement;
                            if (checkedAssessmentRadio) {
                                displayValue += ` (${checkedAssessmentRadio.value})`;
                            } else if (element.value) { // Only show 'not selected' if a number is entered
                                displayValue += ' (Assessment type not selected)';
                            }
                        }
                        break;
                    case 'text':
                    case 'textarea':
                    default:
                        displayValue = element.value || 'N/A';
                        break;
                }
            }
             // Don't add system select placeholders if they are not visible/relevant
            if (field.containerId && field.type === 'select' && field.id.includes('-system-select')) {
                const container = document.getElementById(field.containerId);
                if (container && container.style.display === 'none') {
                    return; // Skip this field
                }
            }

            reportData.push({
                section: section.title,
                label: field.label,
                value: displayValue
            });
        });
    });
    return reportData;
}

async function buildPdfDocument(approvedExecSummary: string, approvedFinalSummary: string) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    if (loadingOverlay && loadingText) {
        loadingText.textContent = 'Generating Report...';
        loadingOverlay.style.display = 'flex';
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        if (typeof doc.autoTable !== 'function') {
            console.error("jsPDF-AutoTable plugin is not loaded correctly!");
            alert("Error: PDF generation plugin (AutoTable) is missing. Cannot generate report.");
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            return;
        }
        
        // Update the form field in the UI with the approved text, so it's reflected in the table
        const finalSummaryTextarea = document.getElementById('final-summary-evaluation') as HTMLTextAreaElement;
        if (finalSummaryTextarea) {
            finalSummaryTextarea.value = approvedFinalSummary;
             autoResizeTextarea(finalSummaryTextarea);
        }
        
        const reportItems = collectReportData();
        const crossingId = getElementValue('crossing-id');
        
        const rawDate = getElementValue('assessment-date'); // YYYY-MM-DD
        let assessmentDate = 'N/A';
        if (rawDate) {
            const [year, month, day] = rawDate.split('-');
            assessmentDate = `${month}/${day}/${year}`;
        }

        const assessorName = getElementValue('assessor-name');
        const immediateHazards = getElementValue('immediate-hazards');
        
        // --- File Processing ---
        const allFilesWithComments = [
            ...(fileDataStore['file-attachments'] || []),
            ...(fileDataStore['installation-records'] || [])
        ];

        const imageFiles = allFilesWithComments.filter(item => item.type.startsWith('image/'));

        const processedImages = await Promise.all(
            imageFiles.map(async (item) => {
                try {
                    const img = new Image();
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                        img.src = item.dataUrl;
                    });
                    return {
                        name: item.name,
                        comment: item.comment,
                        dataUrl: item.dataUrl,
                        width: img.width,
                        height: img.height,
                        type: item.type.replace('image/', '').toUpperCase()
                    };
                } catch (error) {
                    console.error(`Error processing image ${item.name}:`, error);
                    return null;
                }
            })
        );
        const validImages = processedImages.filter(img => img !== null) as NonNullable<typeof processedImages[0]>[];


        // --- PDF Generation ---
        const addHeaderFooter = () => {
            const pageCount = (doc.internal as any).getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFont('helvetica', 'normal'); // Explicitly set font style to prevent errors
                doc.setFontSize(9);
                doc.setTextColor(128);
                doc.text(`Pipeline Crossing Assessment: ${crossingId}`, 15, 10);
                doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 15, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
            }
        };

        // --- Title Page ---
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('Pipeline Bridge Crossing', 105, 60, { align: 'center' });
        doc.text('Assessment Report', 105, 70, { align: 'center' });
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text(`Crossing ID: ${crossingId}`, 105, 90, { align: 'center' });
        doc.text(`Assessment Date: ${assessmentDate}`, 105, 100, { align: 'center' });
        doc.text(`Assessed By: ${assessorName}`, 105, 110, { align: 'center' });
        
        // --- Executive Summary Page ---
        doc.addPage();
        let yPos = 25;
        doc.setFontSize(18);
        doc.text("Executive Summary", 15, yPos);
        yPos += 2;
        doc.setLineWidth(0.5);
        doc.line(15, yPos, 195, yPos);
        yPos += 8;

        const writeTextBlock = (title: string, content: string, titleOptions: any = {}, contentOptions: any = {}) => {
            if (content && content !== 'N/A' && content.trim() !== '') {
                doc.setFontSize(12);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(titleOptions.color || 0);
                doc.text(title, 15, yPos);
                yPos += 6;
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(contentOptions.color || 0);
                const splitText = doc.splitTextToSize(content, 180);
                doc.text(splitText, 15, yPos);
                yPos += (splitText.length * 5) + 5;
                doc.setTextColor(0); // Reset color
            }
        };
        
        writeTextBlock('Executive Summary:', approvedExecSummary);
        
        if (immediateHazards && immediateHazards.trim() !== '' && immediateHazards !== 'N/A') {
            writeTextBlock('IMMEDIATE HAZARDS IDENTIFIED:', immediateHazards, { color: [194, 25, 25] });
        }
        
        // --- Detailed Data Table Page ---
        const finalReportItems = collectReportData();
        
        doc.addPage();
        const tableData = finalReportItems
            .filter(item => {
                if (item.label.startsWith('System (NU') || item.label.startsWith('System (FG&E') || item.label.startsWith('System (Bangor Natural Gas)')) {
                    const docVal = getElementValue('doc-center');
                    if (item.label.includes('Bangor Natural Gas') && docVal !== 'bng') return false;
                    if (item.label.includes('Maine') && docVal !== 'nu_me') return false;
                    if (item.label.includes('Hampshire') && docVal !== 'nu_nh') return false;
                    if (item.label.includes('FG&E') && docVal !== 'fge') return false;
                }
                if (item.label.toLowerCase().startsWith('specify other') && (item.value === 'N/A' || item.value.trim() === '')) {
                    return false;
                }
                return true;
            })
            .map(item => [item.section, item.label, item.value]);

        (doc as any).autoTable({
            head: [['Section', 'Field Description', 'Value / Observation']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [0, 90, 156] },
            startY: 25,
            didParseCell: (data: any) => {
                if (data.cell.section === 'body' && data.column.index === 0) {
                    if (data.row.index > 0 && data.table.body[data.row.index - 1].cells[0].raw === data.cell.raw) {
                        data.cell.text = '';
                    }
                }
            },
            willDrawPage: (data: any) => {
                doc.setFontSize(18);
                doc.text("Detailed Assessment Data", 15, 18);
            }
        });

        // --- Photographs Section ---
        if (validImages.length > 0) {
            doc.addPage();
            yPos = 25;
            doc.setFontSize(18);
            doc.text("Photographs", 15, yPos);
            yPos += 2;
            doc.setLineWidth(0.5);
            doc.line(15, yPos, 195, yPos);
            yPos += 8;
            
            for (const img of validImages) {
                const pageHeight = doc.internal.pageSize.getHeight();
                const pageWidth = doc.internal.pageSize.getWidth();
                const margin = 15;

                const maxWidth = pageWidth - (2 * margin);
                const maxHeight = pageHeight / 2.5;

                // New, robust scaling logic
                const widthRatio = maxWidth / img.width;
                const heightRatio = maxHeight / img.height;
                // Use Math.min to find the most constraining ratio. Cap at 1 so we don't scale up small images.
                const ratio = Math.min(widthRatio, heightRatio, 1);
        
                const imgWidth = img.width * ratio;
                const imgHeight = img.height * ratio;
                
                const requiredSpace = imgHeight + 25; // Approximate space needed for image and caption

                if (yPos + requiredSpace > pageHeight - margin) {
                    doc.addPage();
                    yPos = 25;
                    doc.setFontSize(18);
                    doc.text("Photographs (continued)", 15, yPos);
                    yPos += 2;
                    doc.setLineWidth(0.5);
                    doc.line(15, yPos, 195, yPos);
                    yPos += 8;
                }
                
                const x = (pageWidth - imgWidth) / 2; // Center the image
                doc.addImage(img.dataUrl, img.type, x, yPos, imgWidth, imgHeight);
                yPos += imgHeight + 5;
                
                doc.setFontSize(9);
                doc.setTextColor(100);
                doc.setFont('helvetica', 'bold');
                doc.text(img.name, pageWidth / 2, yPos, { align: 'center' });
                yPos += 4;

                if (img.comment) {
                    doc.setFont('helvetica', 'italic');
                    doc.setTextColor(120);
                    const commentText = doc.splitTextToSize(`Comment: ${img.comment}`, maxWidth - 10);
                    doc.text(commentText, pageWidth / 2, yPos, { align: 'center' });
                    yPos += commentText.length * 3.5;
                    doc.setFont('helvetica', 'normal'); // Reset font style after using italic
                }
                yPos += 10;
            }
        }
        
        // Finalize: Add headers and footers to all pages
        addHeaderFooter();

        doc.save(`Pipeline_Assessment_Report_${crossingId.replace(/[^a-z0-9]/gi, '_') || 'Unnamed'}.pdf`);
        alert('Report generation complete!');
    } catch (err) {
        console.error("Failed to generate report:", err);
        alert("An unexpected error occurred while generating the report. Check the console for details.");
    } finally {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
}

// New helper function to create a concise text summary of form data for the AI prompt
function generateTextSummaryForAI(): string {
    const reportItems = collectReportData();
    let lastSection = '';
    const summaryLines: string[] = [];

    reportItems.forEach(item => {
        // Exclude bulky file data and truly empty values from the AI prompt.
        if (item.label.includes('Upload Photographs') ||
            item.label.includes('Installation Records') ||
            item.value === 'No files attached.' ||
            item.value === 'N/A' ||
            !item.value.trim() ||
            item.value === 'None selected') {
            return;
        }

        if (item.section !== lastSection) {
            summaryLines.push(`\n## ${item.section}\n`);
            lastSection = item.section;
        }
        summaryLines.push(`- **${item.label.replace(':', '')}:** ${item.value}`);
    });

    return summaryLines.join('\n');
}


async function handleGenerateReport() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const modal = document.getElementById('summary-review-modal');

    if (loadingOverlay && loadingText) {
        loadingText.textContent = 'Generating Summaries...';
        loadingOverlay.style.display = 'flex';
    }

    let executiveSummaryText = "Could not generate summary.";
    let finalSummaryEvalText = getElementValue('final-summary-evaluation');
    // Generate a concise text summary instead of sending the entire raw JSON data
    const textSummaryForAI = generateTextSummaryForAI();

    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        
        const execSummaryPrompt = `Based on the following pipeline assessment data, write a concise, high-level executive summary for the first page of a formal report. Focus on the overall condition, most critical findings, and primary recommendations. The tone should be professional and objective. Data:\n${textSummaryForAI}`;
        const finalSummaryPrompt = `Based on the following pipeline assessment data, write a detailed "Final Summary of Evaluation". This will be placed in the main data table of the report. It should be a comprehensive paragraph summarizing the key findings, observed conditions, and the justification for the recommendations. Data:\n${textSummaryForAI}`;

        // Run both API calls in parallel
        const [execSummaryResponse, finalSummaryResponse] = await Promise.all([
            ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: execSummaryPrompt }),
            ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: finalSummaryPrompt })
        ]);

        executiveSummaryText = execSummaryResponse.text;
        finalSummaryEvalText = finalSummaryResponse.text;
        
    } catch (apiError) {
        console.error("Gemini API Error:", apiError);
        alert("Warning: Could not connect to the AI service to generate summaries. Please write them manually.");
        executiveSummaryText = "Failed to generate summary. Please enter manually.";
        finalSummaryEvalText = getElementValue('final-summary-evaluation') || "Failed to generate summary. Please enter manually.";
    } finally {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    // --- Setup and Show Modal ---
    if (!modal) return;
    const execSummaryTextarea = document.getElementById('modal-exec-summary') as HTMLTextAreaElement;
    const finalSummaryTextarea = document.getElementById('modal-final-summary') as HTMLTextAreaElement;
    const cancelButton = document.getElementById('modal-cancel-button');
    const generatePdfButton = document.getElementById('modal-generate-pdf-button');
    const execSummaryWrapper = document.getElementById('modal-exec-summary-wrapper')!;
    const finalSummaryWrapper = document.getElementById('modal-final-summary-wrapper')!;

    execSummaryTextarea.value = executiveSummaryText;
    finalSummaryTextarea.value = finalSummaryEvalText;

    [execSummaryTextarea, finalSummaryTextarea].forEach(autoResizeTextarea);
    execSummaryTextarea.oninput = () => autoResizeTextarea(execSummaryTextarea);
    finalSummaryTextarea.oninput = () => autoResizeTextarea(finalSummaryTextarea);

    // Add improve buttons if in admin mode
    if (document.body.classList.contains('voice-enabled')) {
        addImproveButton(execSummaryWrapper, execSummaryTextarea);
        addImproveButton(finalSummaryWrapper, finalSummaryTextarea);
    }
    
    // Define a single handler for the generate button to be able to remove it later
    const generateHandler = () => {
        modal.style.display = 'none';
        const approvedExec = execSummaryTextarea.value;
        const approvedFinal = finalSummaryTextarea.value;
        buildPdfDocument(approvedExec, approvedFinal);
        generatePdfButton?.removeEventListener('click', generateHandler); // Cleanup
    };

    if (cancelButton) {
        cancelButton.onclick = () => {
            modal.style.display = 'none';
            generatePdfButton?.removeEventListener('click', generateHandler); // Cleanup
        };
    }
    if (generatePdfButton) {
        // Remove old listener before adding a new one to prevent multiple triggers
        generatePdfButton.removeEventListener('click', generateHandler);
        generatePdfButton.addEventListener('click', generateHandler);
    }

    modal.style.display = 'flex';
}


function handleLoadExampleAssessment() {
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    const currentDate = `${year}-${month}-${day}`; // Format for date input: YYYY-MM-DD
    
    // Using a 1x1 transparent PNG for image placeholders.
    const placeholderImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';


    const exampleData: Record<string, any> = {
        // Section 1: General Site & Crossing Information
        'assessment-date': currentDate,
        'assessor-name': 'Timothy Bickford (Example)',
        'doc-center': 'nu_me', // Northern Utilities - Maine
        'crossing-id': 'ME-WELLS-001-RTE109',
        'crossing-description': 'Pipeline crossing attached to the south side of the Rte 109 bridge over the Webhannet River. Access via shoulder of Rte 109.',
        'gps-lat': '43.3105° N',
        'gps-lon': '70.5730° W',
        
        // Section 2: Bridge & Environmental Context
        'road-name': 'Route 109',
        'feature-crossed': 'Webhannet River',
        'bridge-name': 'Route 109 Bridge',
        'bridge-number': 'BR-ME-45A',
        'bridge-type': 'girder',
        'bridge-material': 'composite',
        'ambient-temp': '68',
        'weather-conditions': 'Sunny, clear, light breeze.',
        'vegetation-growth': 'Minor grass and weeds growing near abutments, but not impacting pipe or supports. No trees in immediate vicinity.',
        'scour-erosion': 'No significant scour observed around bridge abutments or piers. River banks appear stable.',
        'proximity-water': 'Pipeline crosses directly over the Webhannet River, a tidal estuary. Pipe is approximately 12 feet above mean high water.',
        'debris-accumulation': 'Some small branches and leaves accumulated on the lower flange of a bridge girder near the pipe, but not in direct contact or causing an issue.',

        // Section 3: Pipeline Identification & Specifications
        'pipeline-material': 'steel_pipe',
        'pipeline-diameter': '6', // 6"
        'pipeline-diameter-other': '',
        'pipe-wall-thickness': '0.280',
        'pipe-wall-thickness-assessment-type': 'Stamped on Pipe',
        'installation-temp': '50',
        'installation-temp-assessment-type': 'Documented in Original Installation Records',
        'nu-me-system-select': nuMeSystems.findIndex(s => s.ds === '535' && s.name === 'Route 109').toString(), // Auto-populates MAOP based on selection
        'maop-unit': 'psig', // Will be auto-populated by nu-me-system-select change
        'maop-value': '56',   // Will be auto-populated

        // Section 4: Pipeline Support & Anchorage System
        'pipeline-support-methods-ring_girders': true,
        'pipeline-support-methods-hangers_rods': true,
        'other-support-specify': '',
        'support-condition-thermal-stress': 'minor_stress_wear',
        'support-condition-thermal-stress-comments': 'Minor paint cracking observed at some hanger connections to bridge steel, possibly due to thermal cycling. No visible deformation of supports.',
        'pipe-movement-at-supports': 'correctly_positioned',
        'pipe-movement-at-supports-comments': 'Pipe appears to be centered on supports. No evidence of excessive rubbing.',
        'sliding-roller-functionality': 'na_no_sliding_roller',
        'sliding-roller-functionality-comments': '',
        'support-comments': 'Supports are generally in good condition. Some surface rust on older hanger components. Hangers appear to allow for some longitudinal movement.',

        // Section 5: Thermal Expansion & Movement Accommodation
        'pipeline-expansion-features-designed_slack': true,
        'other-expansion-specify': '',
        'expansion-feature-functionality': 'functional_good_condition',
        'expansion-feature-functionality-comments': 'Offsets on either side of the bridge appear to provide adequate slack for thermal movement. No signs of strain.',
        'expansion-comments': 'The pipeline configuration includes gentle bends before and after the bridge attachment, likely accommodating thermal changes.',

        // Section 6: Pipeline Condition & Coating Assessment
        'external-corrosion': 'minor',
        'coating-type': 'x_tru_coat',
        'other-coating-type-specify': '',
        'coating-condition': 'fair',
        'coating-comments': 'Coating is generally intact. Minor abrasions and scratches noted on the underside of the pipe, possibly from debris or during installation. One area (approx 6" x 2") near a support shows some coating disbondment, requires further investigation.',
        'test-station-accessible': 'yes',
        'pipe-to-soil-potential': '-1150',
        'cp-comments': 'Test station found on east abutment. Reading is well within acceptable limits, indicating effective CP.',
        'pipe-physical-damage': 'One small dent (approx 1" diameter, 1/8" deep) observed on the top of the pipe mid-span. Appears to be old, no associated coating damage.',
        'atmospheric-corrosion-details': 'Minor surface rust on exposed bolts of support clamps. Pipe coating is mostly intact.',

        // Section 7: Pipe Clearances & Measurements
        'clearance-vertical-above': '3.5',
        'clearance-vertical-above-assessment-type': 'Measured',
        'clearance-vertical-below': '12.0',
        'clearance-vertical-below-assessment-type': 'Measured',
        'clearance-horizontal-abutment': '2.0',
        'clearance-horizontal-abutment-assessment-type': 'Estimated',
        'clearance-horizontal-other': 'N/A',
        'clearance-horizontal-other-assessment-type': 'Could not Assess',
        'clearance-comments': 'Vertical clearance to water at mean high tide appears adequate. Clearance to bridge deck is sufficient. Horizontal clearance to abutment is good.',

        // Section 8: Access & Safety
        'accessibility-inspection': 'fair',
        'safety-hazards': 'Working over water. Traffic on Rte 109 is moderate to heavy. Shoulder is narrow for parking and access.',
        'access-structures-condition': 'N/A - Direct access from bridge deck and ground.',
        'access-safety-comments': 'Requires traffic control for any significant work. Fall protection needed if working over the side of the bridge.',

        // Section 9: Photographs & Attachments
        'photographs-taken': 'Overall upstream view, overall downstream view, typical support detail, coating abrasion example, dent location, clearance to water.',
        'installation-records': [
            { name: "As_Built_Drawing.jpeg", comment: "Image of as-built drawing from original 1998 installation.", type: "image/jpeg", dataUrl: placeholderImageDataUrl }
        ],
        'file-attachments': [
            { name: "Photo_Upstream_View.jpg", comment: "Upstream view showing pipe attachment to bridge girders.", type: "image/jpeg", dataUrl: placeholderImageDataUrl },
            { name: "Photo_Coating_Damage.jpg", comment: "Close-up of the disbonded coating area near support #3.", type: "image/jpeg", dataUrl: placeholderImageDataUrl },
            { name: "Sketch_of_Dent.png", comment: "Field sketch showing location and approximate size of dent.", type: "image/png", dataUrl: placeholderImageDataUrl }
        ],

        // Section 10: Third-Party Infrastructure & Proximity
        'other-utilities-bridge': 'Telecom cables also attached to the bridge, approximately 5ft away from the gas pipeline, on the opposite side of the walkway.',
        'bridge-structure-condition': 'Bridge steel shows some areas of surface rust and peeling paint. Concrete deck appears in fair condition with some minor cracking. Expansion joints appear functional.',
        'third-party-damage-potential': 'Low risk. No active construction nearby. Potential for vehicle impact on bridge could affect pipe, but supports seem robust.',
        'third-party-comments': 'Coordinate with bridge owner (MaineDOT) for any bridge maintenance activities.',

        // Section 11: Immediate Hazards or Concerns Noted
        'immediate-hazards': 'None identified.',
        'actions-taken-hazards': '',

        // Section 12: Recommendations
        'recommendation-actions': 'further_inspection_ndt',
        'recommendation-priority': 'medium',
        'recommendations-summary': 'Recommend detailed NDT (e.g., UT) on the dented area (1" diameter) on top of pipe mid-span to confirm wall thickness. Also, recommend close-up inspection and potential repair of the 6"x2" area of disbonded coating near support #3. Re-evaluate in 12 months.',
        'final-summary-evaluation': 'The Rte-109 Wells Maine pipeline crossing is generally in fair condition. The primary concerns are a small dent and an area of disbonded coating that require further investigation. Supports and clearances are adequate. No immediate hazards identified.'
    };
    populateFormWithData(exampleData);
    alert('Example assessment data for "Rte-109 Wells Maine" loaded!');
}


document.addEventListener('DOMContentLoaded', () => {
    renderForm();
    setupTabs();
    populateProcessGuidelines();
    setupDocDependentFields(); 


    const formContainer = document.getElementById('assessment-form-container');
    const processContainer = document.getElementById('process-guidelines-container');
    if (formContainer) formContainer.style.display = 'block';
    if (processContainer) processContainer.style.display = 'none';
    
    // Ensure all conditional system select containers are initially hidden by JS too
    ['bng-system-select-container', 'nu-me-system-select-container', 'nu-nh-system-select-container', 'fge-system-select-container'].forEach(id => {
        const container = document.getElementById(id);
        if (container) container.style.display = 'none';
    });


    const tabForm = document.getElementById('tab-form');
    if (tabForm) {
        tabForm.classList.add('active');
        tabForm.setAttribute('aria-selected', 'true');
    }

    const saveButton = document.getElementById('save-assessment-button');
    const openButton = document.getElementById('open-assessment-button');
    const generateReportButton = document.getElementById('generate-report-button');
    const exampleAssessmentButton = document.getElementById('example-assessment-button');
    const fileInput = document.getElementById('open-file-input') as HTMLInputElement;

    if (saveButton) saveButton.addEventListener('click', handleSaveAssessment);
    if (openButton) openButton.addEventListener('click', handleOpenAssessment);
    if (generateReportButton) generateReportButton.addEventListener('click', handleGenerateReport);
    if (exampleAssessmentButton) exampleAssessmentButton.addEventListener('click', handleLoadExampleAssessment);
    
    // Admin Unlock Logic
    const adminPasswordInput = document.getElementById('admin-password') as HTMLInputElement;
    const adminUnlockButton = document.getElementById('admin-unlock-button') as HTMLButtonElement;
    const adminContainer = document.getElementById('admin-unlock-container');

    if (adminPasswordInput && adminUnlockButton && adminContainer) {
        const unlockVoiceFeature = () => {
            if (adminPasswordInput.value === '0665') {
                document.body.classList.add('voice-enabled');
                adminContainer.innerHTML = `<span class="unlocked-message">Voice Feature Unlocked</span>`;
            } else {
                adminPasswordInput.style.borderColor = '#d9534f'; // A red color for error
                adminPasswordInput.value = '';
                adminPasswordInput.placeholder = 'Incorrect';
                // Vibrate to give haptic feedback on mobile if available
                if (navigator.vibrate) {
                    navigator.vibrate(100);
                }
            }
        };

        adminUnlockButton.addEventListener('click', unlockVoiceFeature);

        adminPasswordInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Stop form submission or other default behavior
                unlockVoiceFeature();
            }
        });

        // Reset visual feedback on focus
        adminPasswordInput.addEventListener('focus', () => {
            adminPasswordInput.style.borderColor = '';
            adminPasswordInput.placeholder = 'Code';
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const fileContent = e.target?.result as string;
                        if (!fileContent) {
                             alert('Error: File content is empty.');
                             return;
                        }
                        const jsonData = JSON.parse(fileContent);
                        populateFormWithData(jsonData);
                    } catch (error) {
                        console.error('Error parsing JSON file:', error);
                        alert('Error: Could not parse the selected file. Please ensure it is a valid JSON assessment file.');
                    } finally {
                        fileInput.value = '';
                    }
                };
                reader.onerror = () => {
                    alert('Error reading file.');
                    fileInput.value = '';
                }
                reader.readAsText(file);
            }
        });
    }
});

export {};