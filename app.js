pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/build/pdf.worker.min.js';

class DocumentAnalyzer {
    constructor() {
        this.pdfData = new Map(); 
        this.totalPages = 0;
        this.processedPages = 0;
        this.elements = this.cacheElements();
        this.bindEvents();
    }
    cacheElements() {
        return {
            form: document.getElementById('document-form'),
            loadingOverlay: document.getElementById('loading-overlay'),
            loadingText: document.getElementById('loading-text'),
            loadingProgress: document.getElementById('loading-progress'),
            pdfInfoCard: document.getElementById('pdf-info-card'),
            resultsCard: document.getElementById('results-card'),
            resultsContainer: document.getElementById('results-container'),
            themeToggle: document.getElementById('theme-toggle'),
            apiKey: document.getElementById('api-key'),
            pdfFile: document.getElementById('pdf-upload'),
            question: document.getElementById('compliance-question'),
            modelSelection: document.getElementById('model-selection'),
            pdfFilename: document.getElementById('pdf-filename'),
            pdfPagecount: document.getElementById('pdf-pagecount'),
            pdfProcessingMode: document.getElementById('pdf-processing-mode')
        };
    }

    bindEvents() {
        this.elements.form.addEventListener('submit', this.handleFormSubmit.bind(this));
    }

    async handleFormSubmit(event) {
        event.preventDefault();
        this.resetAnalysis();
        const formData = this.getFormData();
        if (!this.validateFormData(formData)) return;
        
        try {
            this.updateProgress(0, 'Processing PDF...');
            await this.extractTextFromPDF(formData.pdfFile);
            
            this.displayPDFInfo(formData.pdfFile.name);
            
            this.updateProgress(85, 'Analyzing with AI...');
            const result = await this.sendToLLM(formData.question, formData.apiKey, formData.modelSelection);
            
            this.displayResults(result);
            this.updateProgress(100, 'Complete!');
            
        } catch (error) {
            console.error('Error processing document:', error);
            this.showAlert(`Error: ${error.message}`, 'danger');
        } finally {
            this.hideLoading();
        }
    }

    resetAnalysis() {
        this.pdfData.clear();
        this.totalPages = 0;
        this.processedPages = 0;
        this.elements.resultsCard.classList.add('d-none');
        this.elements.resultsContainer.innerHTML = '';
    }

    getFormData() {
        return {
            apiKey: this.elements.apiKey.value,
            pdfFile: this.elements.pdfFile.files[0],
            question: this.elements.question.value,
            modelSelection: this.elements.modelSelection.value
        };
    }

    validateFormData(formData) {
        if (!formData.pdfFile || !formData.question || !formData.apiKey) {
            this.showAlert('Please fill in all required fields', 'danger');
            return false;
        }
        return true;
    }

    showAlert(message, type) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show py-2 small`;
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        
        this.elements.form.parentNode.insertBefore(alertDiv, this.elements.form);
        
        setTimeout(() => {
            alertDiv.classList.remove('show');
            setTimeout(() => alertDiv.remove(), 150);
        }, 5000);
    }

    async extractTextFromPDF(pdfFile) {
        const arrayBuffer = await this.readFileAsArrayBuffer(pdfFile);
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        this.totalPages = pdf.numPages;
        this.processedPages = 0;
        
        const batchSize = 5;
        for (let i = 1; i <= pdf.numPages; i += batchSize) {
            const batch = [];
            const endPage = Math.min(i + batchSize - 1, pdf.numPages);
            
            for (let pageNum = i; pageNum <= endPage; pageNum++) {
                batch.push(this.extractPageText(pdf, pageNum));
            }
            
            await Promise.all(batch);
            
            const progress = Math.round((i / pdf.numPages) * 80);
            this.updateProgress(progress, `Processing page ${i} of ${pdf.numPages}...`);
        }
    }

    async extractPageText(pdf, pageNum) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        this.pdfData.set(pageNum, pageText);
        this.processedPages++;
    }

    updateProgress(percent, message) {
        this.elements.loadingProgress.style.width = `${percent}%`;
        this.elements.loadingText.textContent = message;
        this.elements.loadingOverlay.classList.remove('d-none');
    }

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    async sendToLLM(question, apiKey, model) {
        const shouldProcessInChunks = this.totalPages > 100;
        
        if (shouldProcessInChunks) {
            return await this.processInChunks(question, apiKey, model);
        } else {
            return await this.processSingleRequest(question, apiKey, model);
        }
    }

    async processSingleRequest(question, apiKey, model) {
        const prompt = this.buildPrompt(question, this.pdfData);
        const response = await this.callAPI(prompt, apiKey, model);
        return this.parseResponse(response);
    }

    async processInChunks(question, apiKey, model) {
        const chunks = this.createChunks(50);
        const allFindings = [];
        
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const progress = 85 + Math.round((chunkIndex / chunks.length) * 10);
            this.updateProgress(progress, `Analyzing chunk ${chunkIndex + 1} of ${chunks.length}...`);
            
            const chunkPrompt = this.buildChunkPrompt(question, chunks[chunkIndex], chunkIndex + 1, chunks.length);
            const response = await this.callAPI(chunkPrompt, apiKey, model);
            const chunkResult = this.parseResponse(response);
            
            chunkResult.chunkNumber = chunkIndex + 1;
            chunkResult.totalChunks = chunks.length;
            
            const chunkPages = Object.keys(chunks[chunkIndex]).map(n => Number(n));
            const parsedPageNum = parseInt(chunkResult.page_number, 10);
            if (isNaN(parsedPageNum) || !chunkPages.includes(parsedPageNum)) {
                chunkResult.page_number = 'N/A';
            }
            
            allFindings.push(chunkResult);
        }
        
        return allFindings;
    }

    createChunks(chunkSize) {
        const chunks = [];
        const pages = Array.from(this.pdfData.keys()).sort((a, b) => a - b);
        
        for (let i = 0; i < pages.length; i += chunkSize) {
            const chunk = {};
            const endIndex = Math.min(i + chunkSize, pages.length);
            
            for (let j = i; j < endIndex; j++) {
                const pageNum = pages[j];
                chunk[pageNum] = this.pdfData.get(pageNum);
            }
            
            chunks.push(chunk);
        }
        
        return chunks;
    }

    async callAPI(prompt, apiKey, model) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'Document Compliance Analyzer'
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
    }

    buildPrompt(question, pdfData) {
        const pages = Array.from(pdfData.entries()).sort((a, b) => a[0] - b[0]);
        const documentText = pages.map(([pageNum, text]) => 
            `--- PAGE ${pageNum} ---\n${text.trim()}\n`
        ).join('\n');
        
        return `You are a legal document analysis expert. I need you to analyze a PDF document for compliance information.

TASK:
${question}

DOCUMENT TEXT (by page number):
${documentText}

INSTRUCTIONS:
1. Analyze the document to determine the answer to the compliance question.
2. Provide your findings in a JSON format with the following fields:
   - is_subsidiary: "Yes", "No", or "Not Reported"
   - evidence: The exact text from the document that supports your conclusion (direct quote)
   - page_number: The page number where the evidence was found
   - reasoning: Your analysis and reasoning for the conclusion

Return ONLY the JSON response without any other explanation.`;
    }

    buildChunkPrompt(question, chunkData, chunkNum, totalChunks) {
        const documentText = Object.entries(chunkData)
            .map(([pageNum, text]) => `--- PAGE ${pageNum} ---\n${text.trim()}\n`)
            .join('\n');
        
        return `You are a legal document analysis expert. I need you to analyze a portion of a PDF document for compliance information.

TASK:
${question}

IMPORTANT: This is chunk ${chunkNum} of ${totalChunks} from the document. You are only analyzing this portion.

DOCUMENT TEXT (by page number):
${documentText}

INSTRUCTIONS:
1. Analyze this chunk to determine if it contains any information relevant to the compliance question.
2. If you find relevant information, provide your findings in a JSON format with the following fields:
   - is_subsidiary: "Yes", "No", or "Not Reported"
   - evidence: The exact text from the document that supports your conclusion (direct quote)
   - page_number: The page number where the evidence was found
   - reasoning: Your analysis of this evidence

If you find no relevant information in this chunk, set is_subsidiary to "Not Reported", evidence to empty, and explain in reasoning.

Return ONLY the JSON response without any other explanation.`;
    }

    parseResponse(responseText) {
        try {
            let jsonStr = responseText;
            
            const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }
            
            const result = JSON.parse(jsonStr);
            
            return {
                is_subsidiary: result.is_subsidiary || 'Not Reported',
                evidence: result.evidence || '',
                page_number: result.page_number || 'N/A',
                reasoning: result.reasoning || ''
            };
        } catch (error) {
            console.error('Error parsing LLM response:', error);
            return {
                is_subsidiary: 'Error',
                evidence: 'Failed to parse LLM response.',
                page_number: 'N/A',
                reasoning: `The LLM response could not be properly parsed. Raw response: ${responseText}`
            };
        }
    }

    displayPDFInfo(filename) {
        this.elements.pdfFilename.textContent = filename;
        this.elements.pdfPagecount.textContent = this.totalPages;
        this.elements.pdfProcessingMode.textContent = this.totalPages > 100 ? 'Chunked' : 'Single';
        this.elements.pdfInfoCard.classList.remove('d-none');
    }

    displayResults(result) {
        if (Array.isArray(result)) {
            this.displayMultipleResults(result);
        } else {
            this.displaySingleResult(result);
        }
        this.elements.resultsCard.classList.remove('d-none');
    }

    displaySingleResult(result) {
        const now = new Date();
        this.elements.resultsContainer.innerHTML = `
            <div class="card-header bg-transparent py-2 border-bottom d-flex justify-content-between align-items-center">
                <h5 class="mb-0 small"><i class="bi bi-clipboard-check me-2 text-primary"></i>Analysis Results</h5>
                <span class="text-muted small">${now.toLocaleTimeString()}</span>
            </div>
            <div class="card-body p-3">
                ${this.formatResultHtml(result)}
            </div>
        `;
    }

    displayMultipleResults(resultsArray) {
        const now = new Date();
        const resultsHtml = resultsArray.map((result, index) => 
            this.formatResultHtml(result, index + 1, resultsArray.length)
        ).join('');
        
        this.elements.resultsContainer.innerHTML = `
            <div class="card-header bg-transparent py-2 border-bottom d-flex justify-content-between align-items-center">
                <h5 class="mb-0 small"><i class="bi bi-clipboard-check me-2 text-primary"></i>Analysis Results (Chunks: ${resultsArray.length})</h5>
                <span class="text-muted small">${now.toLocaleTimeString()}</span>
            </div>
            <div class="card-body p-3">
                ${resultsHtml}
            </div>
        `;
    }

    formatResultHtml(result, chunkNumber = null, totalChunks = null) {
        const { badgeClass, iconClass } = this.getResultBadgeClasses(result.is_subsidiary);
        const chunkHeader = chunkNumber ? 
            `<h6 class="mb-3 small text-primary">Chunk ${chunkNumber} of ${totalChunks}</h6>` : '';
        
        const formattedReasoning = result.reasoning ? 
            result.reasoning.split('\n')
                .map(para => para.trim())
                .filter(para => para.length > 0)
                .map(para => `<p class="mb-1">${para}</p>`)
                .join('') : 
            '<p>No detailed reasoning provided.</p>';
        
        return `
            <div class="mb-4 border-bottom pb-3">
                ${chunkHeader}
                <div class="mb-3 text-center">
                    <h6 class="mb-2 small">Compliance Status</h6>
                    <span class="badge rounded-pill px-3 py-2 ${badgeClass}">
                        <i class="bi ${iconClass} me-1"></i>${result.is_subsidiary}
                    </span>
                </div>
                <div class="mb-3">
                    <h6 class="mb-2 small">Evidence</h6>
                    <div class="p-2 bg-body-secondary rounded-2 border-start border-3 border-primary fst-italic small">
                        ${result.evidence || 'No specific evidence provided.'}
                    </div>
                    <div class="text-end mt-1">
                        <span class="badge bg-secondary small">Page ${result.page_number}</span>
                    </div>
                </div>
            </div>
        `;
    }

    getResultBadgeClasses(status) {
        const classes = {
            'Yes': { badgeClass: 'bg-success', iconClass: 'bi-check-circle' },
            'No': { badgeClass: 'bg-danger', iconClass: 'bi-x-circle' },
            'Error': { badgeClass: 'bg-warning text-dark', iconClass: 'bi-exclamation-triangle' }
        };
        
        return classes[status] || { badgeClass: 'bg-secondary', iconClass: 'bi-dash-circle' };
    }

    hideLoading() {
        this.elements.loadingOverlay.classList.add('d-none');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DocumentAnalyzer();
});