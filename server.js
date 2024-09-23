const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = 5000;

// Directory to store temporary files
const TEMP_DIR = 'C:\\Users\\L BALA KRISHNA\\OneDrive - GMR Institute of Technology\\me\\coding_platform\\server\\temp_dir';

// Ensure TEMP_DIR exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Middleware
app.use(cors({ origin: "http://localhost:3000" }));
app.use(bodyParser.json());
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Connect to MongoDB
mongoose
  .connect('mongodb://localhost:27017/problemsdata', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected to problemsdata"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define schemas
const problemSchema = new mongoose.Schema({
  title: String,
  description: String,
  difficulty: String,
  testCases: [
    {
      input: String,
      expectedOutput: String,
    },
  ],
  predefinedCode: {
    javascript: String,
    python: String,
    c: String,
    java: String,
  },
});

const Problem = mongoose.model("Problem", problemSchema);

const submissionSchema = new mongoose.Schema({
  problemId: mongoose.Schema.Types.ObjectId,
  code: String,
  language: String,
  output: String,
  testResults: [
    {
      input: String,
      expectedOutput: String,
      actualOutput: String,
      passed: Boolean,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

const Submission = mongoose.model("Submission", submissionSchema);

// API routes

// Fetch all problems
app.get("/api/problems", async (req, res) => {
  try {
    const problems = await Problem.find();
    res.json(problems);
  } catch (err) {
    console.error("Error fetching problems:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Fetch a problem by ID
app.get("/api/problems/:id", async (req, res) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) {
      return res.status(404).json({ error: "Problem not found" });
    }
    res.json(problem);
  } catch (err) {
    console.error("Error fetching problem:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Add a new problem
app.post("/api/problems", async (req, res) => {
  const { title, description, difficulty, testCases, predefinedCode } = req.body;

  if (!title || !description || !difficulty || !testCases || !predefinedCode) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const newProblem = new Problem({ title, description, difficulty, testCases, predefinedCode });
    await newProblem.save();
    res.status(201).json(newProblem);
  } catch (err) {
    console.error("Error adding problem:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// File extensions and execution commands based on language
const fileExtensions = {
  javascript: 'js',
  python: 'py',
  c: 'c',
  java: 'java',
};

const commands = {
  javascript: (filePath) => `node ${filePath}`,
  python: (filePath) => `python ${filePath}`,
  c: (filePath) => `gcc ${filePath} -o ${filePath}.out && ${filePath}.out`,
  java: (filePath) => `javac ${filePath} && java -cp ${TEMP_DIR} ${path.parse(filePath).name}`,  // Updated for Java
};

// Function to execute code
const executeCode = (code, language, input = "") => {
  return new Promise((resolve, reject) => {
    const fileExtension = fileExtensions[language];
    const fileName = `temp-${Date.now()}.${fileExtension}`;
    const filePath = path.join(TEMP_DIR, fileName);

    console.log(`Writing code to ${filePath}`);

    fs.writeFile(filePath, code, (err) => {
      if (err) {
        return reject(`Error writing file: ${err.message}`);
      }

      let command = commands[language](filePath);
      if (input && language !== 'javascript') {
        // For non-JS languages, use input redirection if needed
        input = input.replace(/"/g, '\\"');
        command = `${command} < ${filePath}`;
      }

      console.log(`Executing command: ${command}`);

      exec(command, { cwd: TEMP_DIR, timeout: 5000 }, (error, stdout, stderr) => {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error(`Error deleting file: ${unlinkErr}`);
          }
        });

        if (error) {
          console.error(`Error: ${error.message}`);
          console.error(`Stderr: ${stderr}`);
          return reject(`Code execution error: ${stderr || error.message}`);
        }

        console.log(`Stdout: ${stdout}`);
        resolve(stdout || stderr);
      });
    });
  });
};

// Submit code for a problem
app.post('/api/submit-code', async (req, res) => {
  const { problemId, language, code } = req.body;

  // Validate problem ID
  if (!mongoose.Types.ObjectId.isValid(problemId)) {
    return res.status(400).json({ error: "Invalid problem ID format" });
  }

  try {
    const problem = await Problem.findById(problemId);
    if (!problem) {
      return res.status(404).json({ error: "Problem not found" });
    }

    // Process code execution
    const testResults = await runCode(language, code, problem.testCases);

    res.json({ testResults });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Function to run code against test cases
const runCode = async (language, code, testCases) => {
  const results = [];
  for (const testCase of testCases) {
    try {
      const input = testCase.input;
      const expectedOutput = testCase.expectedOutput;
      const actualOutput = await executeCode(code, language, input);
      const passed = actualOutput.trim() === expectedOutput.trim();
      results.push({
        input,
        expectedOutput,
        actualOutput: actualOutput.trim(),
        passed,
      });
    } catch (error) {
      results.push({
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        actualOutput: `Error executing code: ${error.message}`,
        passed: false,
      });
    }
  }
  return results;
};

// Delete a problem
app.delete("/api/problems/:id", async (req, res) => {
  const { id } = req.params;
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid problem ID format" });
  }

  try {
    const result = await Problem.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ error: "Problem not found" });
    }
    res.json({ message: "Problem deleted successfully" });
  } catch (err) {
    console.error("Error deleting problem:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
