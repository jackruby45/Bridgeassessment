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
    assessmentOptions?: string[]; // For radio buttons next to an input
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
    'final-summary-evaluation', 'modal-exec-summary', 'modal-final-summary'
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
            const ai = new GoogleGenAI({apiKey: API_KEY});
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
    if (field.type !== 'checkbox-group' && field.type !== 'radio-group' && !field.assessmentOptions) {
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
                fieldset.appendChild(itemContainer);
            });
        }
        inputWrapper.appendChild(fieldset);

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
const bngSystems = [
    { value: '', text: 'Select BNG System...' },
    { value: 'Bangor Steel|500', text: 'Bangor Steel' },
    { value: 'Lincoln|60', text: 'Lincoln' },
    { value: 'Bangor IP|60', text: 'Bangor IP' },
    { value: 'Brewer|60', text: 'Brewer' },
    { value: 'Searsport|60', text: 'Searsport' },
    { value: 'Orrington|720', text: 'Orrington' },
    { value: 'Bucksport|60', text: 'Bucksport' }
];

const nuMeSystems = [
    { value: '', text: 'Select NU-ME System...' },
    { value: 'Portland HP|400', text: 'Portland HP' },
    { value: 'Lewiston HP|250', text: 'Lewiston HP' },
    { value: 'Saco-Biddeford HP|200', text: 'Saco-Biddeford HP' },
    { value: 'Westbrook HP|200', text: 'Westbrook HP' },
    { value: 'Gorham HP|200', text: 'Gorham HP' },
    { value: 'Portland IP|60', text: 'Portland IP' },
    { value: 'Lewiston IP|60', text: 'Lewiston IP' },
    { value: 'Saco-Biddeford IP|60', text: 'Saco-Biddeford IP' },
    { value: 'Westbrook IP|60', text: 'Westbrook IP' },
    { value: 'Augusta-Waterville HP|250', text: 'Augusta-Waterville HP' }
];

const nuNhSystems = [
    { value: '', text: 'Select NU-NH System...' },
    { value: 'Exeter HP|500', text: 'Exeter HP' },
    { value: 'Portsmouth-Dover HP|200', text: 'Portsmouth-Dover HP' },
    { value: 'Nashua HP|200', text: 'Nashua HP' },
    { value: 'Concord HP|200', text: 'Concord HP' },
    { value: 'Laconia HP|200', text: 'Laconia HP' },
    { value: 'Seacoast IP|60', text: 'Seacoast IP' },
    { value: 'Capital IP|60', text: 'Capital IP' },
    { value: 'Southern IP|60', text: 'Southern IP' }
];

const fgeSystems = [
    { value: '', text: 'Select FGE System...' },
    { value: 'Fitchburg HP|500', text: 'Fitchburg HP' },
    { value: 'North Adams HP|200', text: 'North Adams HP' },
    { value: 'Greenfield HP|200', text: 'Greenfield HP' },
    { value: 'Fitchburg IP|60', text: 'Fitchburg IP' }
];


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
                    { value: "truss", text: "Truss" },
                    { value: "arch", text: "Arch" },
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
                    { value: "wood", text: "Wood" },
                    { value: "composite", text: "Composite" },
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
                id: "bng-system-select",
                type: "select",
                options: bngSystems,
                containerId: 'bng-system-select-container'
            },
            {
                label: "System Name",
                id: "nu-me-system-select",
                type: "select",
                options: nuMeSystems,
                containerId: 'nu-me-system-select-container'
            },
            {
                label: "System Name",
                id: "nu-nh-system-select",
                type: "select",
                options: nuNhSystems,
                containerId: 'nu-nh-system-select-container'
            },
            {
                label: "System Name",
                id: "fge-system-select",
                type: "select",
                options: fgeSystems,
                containerId: 'fge-system-select-container'
            },
            { label: "MAOP (PSIG):", id: "maop", type: "number", placeholder: "Max. Allowable Operating Pressure" },
            { label: "Pipe Diameter (inches):", id: "pipe-diameter", type: "number", placeholder: "e.g., 4, 8, 12" },
            { label: "Wall Thickness (inches):", id: "wall-thickness", type: "number", placeholder: "e.g., 0.250" },
            {
                label: "Pipe Material:",
                id: "pipe-material",
                type: "select",
                options: [
                    { value: "", text: "Select Material..." },
                    { value: "steel", text: "Steel" },
                    { value: "plastic", text: "Plastic (PE)" },
                    { value: "cast_iron", text: "Cast Iron" },
                    { value: "other", text: "Other" }
                ]
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
                    { value: "rollers", text: "Roller Supports on Piers/Abutments" },
                    { value: "saddles", text: "Saddle Supports on Piers/Abutments" },
                    { value: "brackets", text: "Brackets Attached to Bridge Deck/Girders" },
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
                label: "Primary Expansion/Contraction Feature:",
                id: "expansion-feature",
                type: "select",
                options: [
                    { value: "", text: "Select Expansion Feature..." },
                    { value: "expansion_loop", text: "Expansion Loop" },
                    { value: "expansion_joint", text: "Expansion Joint (e.g., bellows, slip-type)" },
                    { value: "pipe_flexibility", text: "Designed Pipe Flexibility (offsets, bends)" },
                    { value: "none", text: "None Observed" },
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
                    { value: "fbe", text: "Fusion Bonded Epoxy (FBE)" },
                    { value: "liquid_epoxy", text: "Liquid Epoxy" },
                    { value: "tape_wrap", text: "Tape Wrap (e.g., Polyken, Powercrete)" },
                    { value: "three_layer", text: "Three-Layer Polyethylene/Polypropylene (3LPE/3LPP)" },
                    { value: "none", text: "None / Uncoated" },
                    { value: "unknown", text: "Unknown" },
                    { value: "other", text: "Other (Specify Below)" }
                ]
            },
            { label: "Specify Other Coating Type:", id: "other-coating-type-specify", type: "textarea", placeholder: "Describe if 'Other' was selected." },
            { label: "Comments on Coating:", id: "coating-comments", type: "textarea", placeholder: "Describe condition: holidays, disbondment, mechanical damage, UV degradation." },
            {
                label: "Cathodic Protection (CP):",
                id: "cp-present",
                type: "radio-group",
                checkboxOptions: [
                    { value: "yes", text: "CP is present" },
                    { value: "no", text: "CP is not present" },
                    { value: "unknown", text: "Unknown" }
                ]
            },
            {
                label: "Test Station Found?",
                id: "cp-test-station",
                type: "radio-group",
                checkboxOptions: [
                    { value: "yes", text: "Yes" },
                    { value: "no", text: "No" },
                    { value: "na", text: "N/A" }
                ]
            },
            { label: "Pipe-to-Soil Potential Reading (mV):", id: "cp-potential", type: "number", placeholder: "e.g., -950" },
            { label: "Comments on Cathodic Protection:", id: "cp-comments", type: "textarea", placeholder: "Describe condition of test stations, wires, and any observed issues." }
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
                label: "Clearance Checks:",
                id: "clearance-checks",
                type: "checkbox-group",
                checkboxOptions: [
                    { value: "vertical-hwy", text: "Vertical clearance from highway/roadway" },
                    { value: "horizontal-hwy", text: "Horizontal clearance from highway/roadway" },
                    { value: "vertical-water", text: "Vertical clearance from high water mark" },
                    { value: "horizontal-abutment", text: "Horizontal clearance from bridge abutments" }
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
    const formData: { [key: string]: any } = {};
    formSections.forEach(section => {
        section.fields.forEach(field => {
            if (field.type === 'file' || field.containerId) return;

            const element = document.getElementById(field.id);
            if (!element) return;
            
            if (field.type === 'checkbox-group') {
                const groupElements = document.getElementsByName(field.id) as NodeListOf<HTMLInputElement>;
                formData[field.id] = Array.from(groupElements)
                    .filter(el => el.checked)
                    .map(el => el.value);
            } else if (field.type === 'radio-group') {
                const groupElements = document.getElementsByName(field.id) as NodeListOf<HTMLInputElement>;
                const checkedEl = Array.from(groupElements).find(el => el.checked);
                formData[field.id] = checkedEl ? checkedEl.value : '';
            } else {
                 formData[field.id] = (element as HTMLInputElement).value;
            }
            
            // Handle associated radio buttons like for installation-temp
            if (field.assessmentOptions) {
                const assessmentKey = `${field.id}-assessment`;
                const groupElements = document.getElementsByName(assessmentKey) as NodeListOf<HTMLInputElement>;
                const checkedEl = Array.from(groupElements).find(el => el.checked);
                formData[assessmentKey] = checkedEl ? checkedEl.value : '';
            }
        });
    });

    // Add selected system and MAOP
    const docSelect = document.getElementById('doc-select') as HTMLSelectElement;
    if (docSelect && docSelect.value) {
        const systemSelectId = `${docSelect.value}-system-select`;
        const systemSelect = document.getElementById(systemSelectId) as HTMLSelectElement;
        if(systemSelect) {
            // Store both the value (for loading) and the text (for reporting)
            formData[systemSelectId] = systemSelect.value;
        }
    }
    formData['maop'] = (document.getElementById('maop') as HTMLInputElement).value;

    return formData;
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
        
        // Add event listener for DOC dropdown after it's created
        const docSelect = document.getElementById('doc-select') as HTMLSelectElement;
        if (docSelect) {
            docSelect.addEventListener('change', handleDocChange);
        }
        
        // Add event listener for system dropdowns
        ['bng-system-select', 'nu-me-system-select', 'nu-nh-system-select', 'fge-system-select'].forEach(id => {
            const systemSelect = document.getElementById(id) as HTMLSelectElement;
            if (systemSelect) {
                systemSelect.addEventListener('change', handleSystemChange);
            }
        });
    }
    
    function handleDocChange() {
        const docSelect = document.getElementById('doc-select') as HTMLSelectElement;
        const selectedDoc = docSelect.value;

        // Hide all system containers
        ['bng', 'nu-me', 'nu-nh', 'fge'].forEach(prefix => {
            const container = document.getElementById(`${prefix}-system-select-container`);
            if (container) container.style.display = 'none';
        });

        // Show the relevant system container
        if (selectedDoc) {
            const container = document.getElementById(`${selectedDoc}-system-select-container`);
            if (container) container.style.display = 'block';
        }
        // Reset MAOP
        (document.getElementById('maop') as HTMLInputElement).value = '';
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
                <li><strong>Pipe Details:</strong> Record the diameter, wall thickness, and material. If unknown, state "Unknown".</li>
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
                <li><strong>Feature Identification:</strong> Identify the expansion loop, joint, or other design feature.</li>
                <li><strong>Functionality Comments:</strong> Determine if the feature can move as intended. Is an expansion loop filled with debris? Is a joint leaking or seized?</li>
            </ul>

            <h4>6. Coating and Corrosion Control</h4>
            <p>Examine the primary line of defense against corrosion.</p>
            <ul>
                <li><strong>Coating Type & Condition:</strong> Identify the coating and meticulously document any damage, holidays, disbondment, or degradation.</li>
                <li><strong>Cathodic Protection (CP):</strong> If CP is present, find the nearest test station. Record the pipe-to-soil potential reading. A reading more negative than -850mV is typically considered protected. Note the condition of all visible CP components.</li>
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
                <li><strong>Clearance Checks:</strong> Measure key clearances and record them in the comments. Note any that do not meet company or regulatory standards.</li>
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
                <li><strong>Final Summary:</strong> Provide a brief, high-level summary of the overall condition of the pipeline crossing. This will be automatically enhanced by the AI during report generation.</li>
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
                    const values = Array.isArray(data[key]) ? data[key] : [];
                    for (const el of Array.from(elementsByName) as HTMLInputElement[]) {
                       el.checked = values.includes(el.value);
                    }
                }
            }
        });
        handleDocChange(); // Ensure conditional fields are updated after loading
    }
    
    function generateTextSummaryForAI(formData: { [key: string]: any }): string {
        let summary = "Assessment Data Summary:\n";
        formSections.forEach(section => {
            summary += `\n--- ${section.title} ---\n`;
            section.fields.forEach(field => {
                if (field.type === 'file') return;
                
                let valueKey = field.id;
                // For conditional system dropdowns, find the one that has a value.
                 if (field.containerId) {
                    const docSelectValue = formData['doc-select'];
                    const expectedContainerId = `${docSelectValue}-system-select-container`;
                     if (field.containerId !== expectedContainerId) {
                        return; // Skip non-active conditional fields
                    }
                }

                const rawValue = formData[valueKey];
                if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                    let displayValue: string;
                     if(Array.isArray(rawValue)) {
                        displayValue = rawValue.join(', ');
                    } else if (field.type === 'select' && field.options) {
                        const selectedOption = field.options.find(opt => opt.value === String(rawValue));
                        displayValue = selectedOption ? selectedOption.text : String(rawValue);
                    } else {
                        displayValue = String(rawValue);
                    }

                    if (displayValue) {
                       summary += `${field.label}: ${displayValue}\n`;
                    }
                }

                if(field.assessmentOptions) {
                    const assessmentKey = `${field.id}-assessment`;
                    const assessmentValue = formData[assessmentKey];
                    if (assessmentValue) {
                        summary += `${field.label} (Source): ${assessmentValue}\n`;
                    }
                }
            });
        });
        
        // Add file comments
        summary += "\n--- Attached File Comments ---\n";
        Object.keys(fileDataStore).forEach(inputId => {
           if (fileDataStore[inputId].length > 0) {
               summary += `${inputId}:\n`;
               fileDataStore[inputId].forEach(file => {
                   summary += `- ${file.name}: ${file.comment || 'No comment'}\n`;
               });
           }
        });

        return summary;
    }

    async function handleGenerateReport() {
        const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
        const loadingText = document.getElementById('loading-text') as HTMLElement;
        const modal = document.getElementById('summary-review-modal') as HTMLElement;
        const execSummaryTextarea = document.getElementById('modal-exec-summary') as HTMLTextAreaElement;
        const finalSummaryTextarea = document.getElementById('modal-final-summary') as HTMLTextAreaElement;
        
        loadingText.textContent = "Generating...";
        loadingOverlay.style.display = 'flex';

        const formData = getFormData();
        const textSummary = generateTextSummaryForAI(formData);

        // 2. Generate summaries with AI
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const execSummaryPrompt = `Based on the following pipeline bridge crossing assessment data, write a concise, professional Executive Summary suitable for the first page of an engineering report. Focus on the overall condition, any immediate or high-priority findings, and the general recommendation. Data:\n${textSummary}`;
        const finalSummaryPrompt = `Based on the following pipeline bridge crossing assessment data, write a comprehensive "Final Summary of Evaluation". This should synthesize all key findings from the report into a detailed concluding paragraph. Data:\n${textSummary}`;

        const promises = [
            ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: execSummaryPrompt }),
            ai.models.generateContent({ model: 'gemini-2.5-flash-preview-04-17', contents: finalSummaryPrompt })
        ];

        const [execResult, finalResult] = await Promise.allSettled(promises);

        loadingOverlay.style.display = 'none';

        // 3. Populate and show modal
        execSummaryTextarea.value = (execResult.status === 'fulfilled') 
            ? execResult.value.text 
            : `Warning: Could not connect to the AI service to generate summary. Please write it manually.`;

        finalSummaryTextarea.value = (finalResult.status === 'fulfilled') 
            ? finalResult.value.text 
            : `Warning: Could not connect to the AI service to generate summary. Please write it manually.`;
        
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
    
    function buildPdfDocument(formData: { [key: string]: any }, execSummary: string, finalSummary: string) {
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
                    if (i > 1) { // Add a header to all pages except the first title page
                        doc.text('UNITIL Pipeline Bridge Crossing Assessment Report', margin, margin - 5);
                    }
                    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
                }
            };
            
            // --- Title Page ---
            doc.setFontSize(22);
            doc.setFont('helvetica', 'bold');
            doc.text('UNITIL Pipeline Bridge Crossing Assessment Report', pageWidth / 2, cursorY, { align: 'center' });
            cursorY += 20;

            // Find DOC display text
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

            // --- Data Table Page(s) ---
            doc.addPage();
            
            const reportData: (string | { content: string; styles: { fontStyle: 'bold' } })[][] = [];
            formSections.forEach(section => {
                let sectionHasContent = false;
                const sectionRows: any[][] = [];

                section.fields.forEach(field => {
                    if (field.type === 'file') return;
                    
                    let valueKey = field.id;
                    let displayValue = 'Not provided';
                    
                    if (field.containerId) {
                        const docSelectValue = formData['doc-select'];
                        const expectedContainerId = `${docSelectValue}-system-select-container`;
                        if (field.containerId !== expectedContainerId) {
                            return; // Skip non-active conditional fields
                        }
                    }

                    const value = formData[valueKey];
                    
                    if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0) ) {
                        const rawValueString = Array.isArray(value) ? value.join(', ') : String(value);

                        if (field.type === 'select' && field.options) {
                           // For system dropdowns, value is "Text|MAOP", so extract text part
                            if(rawValueString.includes('|')) {
                                displayValue = rawValueString.split('|')[0];
                            } else {
                                const selectedOption = field.options.find(opt => opt.value === rawValueString);
                                displayValue = selectedOption ? selectedOption.text : rawValueString;
                            }
                        } else {
                            displayValue = rawValueString;
                        }
                        sectionHasContent = true;
                    }

                    if(displayValue !== 'Not provided' || !field.containerId){
                       sectionRows.push([field.label, displayValue]);
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
                    reportData.push([{ content: section.title, styles: { fontStyle: 'bold' } }]);
                    reportData.push(...sectionRows);
                }
            });

            (doc as any).autoTable({
                startY: margin,
                head: [['Field', 'Value']],
                body: reportData,
                theme: 'grid',
                headStyles: { fillColor: [0, 90, 156] },
                columnStyles: {
                    0: { halign: 'left' }, // Align 'Field' column to the left
                },
                didParseCell: function (data: any) {
                    if (data.row.raw.length === 1) {
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = '#eef1f5';
                        data.cell.styles.textColor = '#003366';
                        data.cell.colSpan = 2;
                        data.cell.styles.halign = 'left';
                    }
                }
            });
            
            doc.setFont('helvetica', 'normal');

            // --- Photographs Page(s) ---
            const imageFiles = [...(fileDataStore['photographs'] || []), ...(fileDataStore['other-docs'] || [])]
                .filter(file => file && (file.type === 'image/jpeg' || file.type === 'image/png'));

            if (imageFiles.length > 0) {
                doc.addPage();
                let photoY = margin;

                doc.setFontSize(16);
                doc.setFont('helvetica', 'bold');
                doc.text('Photographs and Attachments', margin, photoY);
                photoY += 10;
                
                imageFiles.forEach((file) => {
                    const imgWidth = 120;
                    const imgHeight = (imgWidth / 4) * 3;
                    const spacing = 10;

                    if (photoY + imgHeight + spacing > pageHeight - margin) {
                        doc.addPage();
                        photoY = margin;
                    }
                    
                    doc.addImage(file.dataUrl, file.type.split('/')[1].toUpperCase(), margin, photoY, imgWidth, imgHeight);
                    
                    if (file.comment) {
                        doc.setFontSize(9);
                        doc.setFont('helvetica', 'italic');
                        const commentLines = doc.splitTextToSize(file.comment, imgWidth);
                        doc.text(commentLines, margin, photoY + imgHeight + 4);
                        doc.setFont('helvetica', 'normal'); // Reset font style
                        photoY += (commentLines.length * 4);
                    }
                    
                    photoY += imgHeight + spacing;
                });
            }

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
            "nu-nh-system-select": "Seacoast IP|60",
            "maop": "60",
            "pipe-diameter": "8",
            "wall-thickness": "0.322",
            "pipe-material": "steel",
            "installation-temp": "60",
            "installation-temp-assessment": "Assumed",
            "support-method": "hangers",
            "support-condition-thermal-stress-comments": "No signs of thermal stress. Hangers appear to be in good condition.",
            "pipe-movement-at-supports-comments": "Pipe appears to be adequately supported with no undue restrictions.",
            "sliding-roller-functionality-comments": "N/A",
            "support-comments": "All U-bolts and fasteners are tight. No significant corrosion noted on supports.",
            "expansion-feature": "pipe_flexibility",
            "expansion-feature-functionality-comments": "The long, sweeping bend on the north approach appears to be providing adequate thermal expansion capability.",
            "expansion-comments": "Overall accommodation for thermal movement appears satisfactory.",
            "coating-type": "fbe",
            "coating-comments": "Coating is in excellent condition. No holidays or damage found during visual inspection.",
            "cp-present": "yes",
            "cp-test-station": "yes",
            "cp-potential": "-1150",
            "cp-comments": "Test station located on the north abutment is in good condition. Wires are secure. P/S potential is well within acceptable limits.",
            "pipe-physical-damage": "No physical damage was observed on the pipeline.",
            "atmospheric-corrosion-details": "No atmospheric corrosion was observed.",
            "clearance-checks": ["vertical-water", "horizontal-abutment"],
            "clearance-comments": "Vertical clearance from high water is approximately 20 feet. Clearance from abutments is > 5 feet.",
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
            "final-summary-evaluation": "The pipeline at this crossing is in excellent condition with no immediate concerns. The support system, coating, and cathodic protection are all functioning as intended. The primary recommendation is to continue routine inspections."
        };
        populateFormWithData(exampleData);
    }
    
    function handleAdminUnlock() {
        const password = adminPasswordInput.value;
        if (password === "0665") {
            document.body.classList.add('voice-enabled');
            const successMessage = document.createElement('span');
            successMessage.className = 'unlocked-message';
            successMessage.textContent = 'Voice Feature Unlocked';
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
});