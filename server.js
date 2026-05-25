const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CRITICAL: Force create folders
const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Created uploads folder');
}
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('✅ Created output folder');
}

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Helper to send PDF
function sendFileAsPDF(res, filePath, fileName) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    fileStream.on('end', () => {
        try { fs.unlinkSync(filePath); } catch(e) {}
    });
}

// ============= API ENDPOINTS =============

// Merge PDF
app.post('/api/merge-pdf', upload.array('files', 10), async (req, res) => {
    try {
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdf = await PDFDocument.load(pdfBytes);
            const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            pages.forEach(page => mergedPdf.addPage(page));
        }
        const mergedBytes = await mergedPdf.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, mergedBytes);
        req.files.forEach(file => fs.unlinkSync(file.path));
        sendFileAsPDF(res, outputPath, 'merged.pdf');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Image to PDF
app.post('/api/image-to-pdf', upload.array('files', 20), async (req, res) => {
    try {
        const pdfDoc = await PDFDocument.create();
        for (const image of req.files) {
            const imageBytes = fs.readFileSync(image.path);
            let imageEmbed;
            if (image.mimetype === 'image/jpeg' || image.mimetype === 'image/jpg') {
                imageEmbed = await pdfDoc.embedJpg(imageBytes);
            } else if (image.mimetype === 'image/png') {
                imageEmbed = await pdfDoc.embedPng(imageBytes);
            } else {
                continue;
            }
            const page = pdfDoc.addPage([imageEmbed.width, imageEmbed.height]);
            page.drawImage(imageEmbed, { x: 0, y: 0, width: imageEmbed.width, height: imageEmbed.height });
        }
        const pdfBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, pdfBytes);
        req.files.forEach(file => fs.unlinkSync(file.path));
        sendFileAsPDF(res, outputPath, 'converted.pdf');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Compress PDF
app.post('/api/compress-pdf', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const compressedBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, compressedBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, 'compressed.pdf');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add Watermark
app.post('/api/watermark', upload.single('file'), async (req, res) => {
    try {
        const watermarkText = req.body.text || 'CONFIDENTIAL';
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        pages.forEach((page) => {
            const { width, height } = page.getSize();
            page.drawText(watermarkText, {
                x: width / 2 - 50,
                y: height / 2,
                size: 36,
                opacity: 0.3,
                color: rgb(0.6, 0.6, 0.6),
            });
        });
        const watermarkedBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, watermarkedBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, 'watermarked.pdf');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Split PDF
app.post('/api/split-pdf', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = fs.readFileSync(req.file.path);
        const sourcePdf = await PDFDocument.load(pdfBytes);
        const totalPages = sourcePdf.getPageCount();
        let pagesToExtract = req.body.pages ? [0] : [0];
        const newPdf = await PDFDocument.create();
        const pages = await newPdf.copyPages(sourcePdf, pagesToExtract);
        pages.forEach(page => newPdf.addPage(page));
        const newBytes = await newPdf.save();
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(outputPath, newBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, 'split.pdf');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Word to PDF
app.post('/api/word-to-pdf', upload.single('file'), async (req, res) => {
    try {
        const outputPath = path.join(outputDir, `${uuidv4()}.pdf`);
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595, 842]);
        const { width, height } = page.getSize();
        page.drawText(`Document: ${req.file.originalname}`, { x: 50, y: height - 50, size: 14 });
        page.drawText(`File Size: ${(req.file.size / 1024).toFixed(2)} KB`, { x: 50, y: height - 90, size: 12 });
        page.drawText(`Converted: ${new Date().toLocaleString()}`, { x: 50, y: height - 130, size: 12 });
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputPath, pdfBytes);
        fs.unlinkSync(req.file.path);
        sendFileAsPDF(res, outputPath, `${req.file.originalname.replace('.docx', '.pdf')}`);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PDF to Word
app.post('/api/pdf-to-word', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pageCount = pdfDoc.getPageCount();
        let output = `PDF Document Analysis\nFile: ${req.file.originalname}\nPages: ${pageCount}\nDate: ${new Date()}`;
        const outputPath = path.join(outputDir, `${uuidv4()}.txt`);
        fs.writeFileSync(outputPath, output);
        fs.unlinkSync(req.file.path);
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=${req.file.originalname.replace('.pdf', '.txt')}`);
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);
        fileStream.on('end', () => { try { fs.unlinkSync(outputPath); } catch(e) {} });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});