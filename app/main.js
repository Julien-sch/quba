const SaxonJS = require("saxon-js");
const axios = require('axios').default;
var FormData = require('form-data');
const { app, BrowserWindow, ipcMain, dialog, ipcRenderer} =require('electron');
const os = require("os");
const { autoUpdater } = require("electron-updater");
const electronLocalShortcut = require("electron-localshortcut");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf");
const Store = require("electron-store");
const isDev = require('electron-is-dev');
const menuFactoryService = require("./menuConfig");
const { setupTitlebar, attachTitlebarToWindow } = require("custom-electron-titlebar/main");

const i18next = require("i18next");
const Backend = require("i18next-fs-backend");
const i18nextOptions = require("./config/i18next.config");
const config = require("./config/app.config");

const fs = require("fs");
const path = require("path");
const store = new Store();
setupTitlebar();

let mainWindow;
let currentLanguage = store.get("language") || config.fallbackLng;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    webPreferences: {
      plugins: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  attachTitlebarToWindow(mainWindow);
  mainWindow.on("closed", function() {
  mainWindow = null;
  });

  mainWindow.webContents.on("new-window", function(
    event,
    url,
    frameName, 
    disposition,
    options,
    additionalFeatures,
    referrer,
    postBody
  ) {
    event.preventDefault();
    const win = new BrowserWindow({
      webContents: options ? options.webContents : {},
      show: false,
    });
    win.once("ready-to-show", () => win.show());
    if (!options.webContents) {
      const loadOptions = {
        httpReferrer: referrer,
      };
      if (postBody != null) {
        const { data, contentType, boundary } = postBody;
        loadOptions.postData = postBody.data;
        loadOptions.extraHeaders = `content-type: ${contentType}; boundary=${boundary}`;
      }

      win.loadURL(url, loadOptions);
    }
    event.newGuest = win;
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.webContents.send("language-change", currentLanguage);
    autoUpdater.checkForUpdatesAndNotify();

    const appArgv = process.argv.slice(isDev ? 2 : 1);
    if (appArgv[0] && appArgv[0].toLowerCase().endsWith(".pdf")) {
      mainWindow.webContents.send("pdf-open", [appArgv[0], null]);
    } else if (appArgv[0] && appArgv[0].toLowerCase().endsWith(".xml")) {
      loadAndDisplayXML(appArgv[0]);
    }
  });

  menuFactoryService.buildMenu(app, mainWindow, i18next, openFile);
  i18next.on("languageChanged", (lng) => {
    currentLanguage = lng;
    store.set("language", lng);
    mainWindow.webContents.send("language-change", lng);
    menuFactoryService.buildMenu(app, mainWindow, i18next, openFile);
  });
  setTimeout(() => {
    mainWindow.webContents.send("goToHome");
  }, 200);
}

app.on("ready", async () => {
  const t = await i18next.use(Backend).init(i18nextOptions);
  createWindow();
  registerShortcuts();
});

function validation() {
  console.log("test");
}
app.on("window-all-closed", function() {
    const tempPath = path.join(app.getPath("temp"), app.getName());
  if (fs.existsSync(tempPath)) {
    console.log("Directory exists!");
    try {
      fs.rmdirSync(tempPath, { recursive: true });

      console.log(`${tempPath} is deleted!`);
    } catch (err) {
      console.error(`Error while deleting ${tempPath}.`);
    }
  } else {
    console.log("Directory not found.");
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", function() {
  if (mainWindow === null) createWindow();
});

function registerShortcuts() {
  electronLocalShortcut.register(mainWindow, "CommandOrControl+B", () => {
    mainWindow.webContents.openDevTools();
  });
  electronLocalShortcut.register(mainWindow, "CommandOrControl+O", () => {
    openFile();
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  listenEvents();
}

function listenEvents() {
  app.on("second-instance", (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      mainWindow.webContents.send("external-file-open", commandLine);
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  ipcMain.on("app_version", (event) => {
    event.sender.send("app_version", { version: app.getVersion() });
  });

  ipcMain.on("toggle-menu-items", (event, flag) => {
    menu.getMenuItemById("file-print").enabled = flag;
  });

  autoUpdater.on("update-available", () => {
    mainWindow.webContents.send("update_available");
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow.webContents.send("update_downloaded");
  });

  ipcMain.on("restart_app", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.on("check-xml", async (event, filePath) => {
    //   check if the PDF contains embedded xml files

    try {
      var loadingTask = pdfjsLib.getDocument(filePath);
      loadingTask.promise
        .then(function(pdf) {
          pdf.getAttachments().then(function(embeddedFiles) {
            let embeddedXML = null;
            if ((typeof embeddedFiles == "object")&&(embeddedFiles !== null)) {
              if (embeddedFiles["factur-x.xml"]) {
                embeddedXML = new TextDecoder().decode(
                  embeddedFiles["factur-x.xml"]["content"]
                );
              }
              if (embeddedFiles["zugferd-invoice.xml"]) {
                // the embedded file can also be named zugferd-invoice.xml
                // if it contained uppercaps like ZUGFeRD-invoice.xml it would be ZF1
                embeddedXML = new TextDecoder().decode(
                  embeddedFiles["zugferd-invoice.xml"]["content"]
                );
              }
              if (embeddedFiles["xrechnung.xml"]) {
                embeddedXML = new TextDecoder().decode(
                  embeddedFiles["xrechnung.xml"]["content"]
                );
              }
            }
            
            if (embeddedXML !== null) {
              transformAndDisplayCII(
                filePath + " (embedded xml)",
                embeddedXML,
                false
              ).then((res) => {
                event.returnValue = res ? res : undefined;
              });
            } else {
              event.returnValue = undefined;
            }
          });
        })
     
        .catch((error) => {
          event.returnValue = undefined;
          displayError("Exception", error.getMessage());
        });
    } catch (error) {
      event.returnValue = undefined;
      console.error("Error", error);
    }
  });
}

function openFile() {
  dialog
    .showOpenDialog(BrowserWindow, {
      path: "",
      properties: ["openFile"],
      filters: [
        {
          name: "all",
          extensions: ["txt"],
        },
      ],
    })
    .then((result) => {
      console.log("result",result);
      if (!result.canceled) {
        let paths = result.filePaths;
        console.log("paths",paths);
        if (paths && paths.length > 0) {
          if (paths[0].toLowerCase().includes(".pdf")) {
            mainWindow.webContents.send("pdf-open", [paths[0], null]);
          } else {
            loadAndDisplayXML(paths[0]);
            // console.log("xml file",paths[0]);
              // const formData = new FormData();
              // const xmlFilePath = 'C:\\Users\\Asim khan\\Documents\\quba-viewer\\000resources\\testfiles\\zugferd_2p1_EXTENDED_Fremdwaehrung.xml';
              // // const xmlFilePath = paths[0];
              // // payload.append("inFile", fs.createReadStream(paths[0]));
              // formData.append("inFile", fs.createReadStream(xmlFilePath));
              // axios.post('http://api.usegroup.de:8080/mustang/validate',formData,{
              //   headers:{
              //     'Content-Type': 'multipart/form-data',
              //   },
              // }) .then(function (response) {
              //   console.log(response);
              // })
              // .catch(function (error) {
              //   console.log(error);
              // });

          }
        }
      }
    });
}

function loadAndDisplayXML(filename) {
  try {
    const content = fs.readFileSync(filename).toString();
    var parser = require("fast-xml-parser");
    let json = parser.parse(content);
    for (let key in json) {
      // parse root node
      if (key.includes("CrossIndustryInvoice")) {
        transformAndDisplayCII(filename, content, true);
      } else if (key.includes("Invoice")) {
        transformAndDisplayUBL(filename, content, true);
      } else {
        displayError(
          "File format not recognized",
          "Is it a UBL 2.1 or UN/CEFACT 2016b XML file or PDF you are trying to open?"
        );
      }
    }
  } catch (e) {
    displayError("Exception", e.message);
  }
}

function transformAndDisplayCII(sourceFileName, content, shouldDisplay) {
  return transformAndDisplay(
    sourceFileName,
    content,
    path.join(__dirname, "xslt", "cii-xr.sef.json"),
    shouldDisplay
  );
}

function transformAndDisplayUBL(sourceFileName, content, shouldDisplay) {
  return transformAndDisplay(
    sourceFileName,
    content,
    path.join(__dirname, "xslt", "ubl-xr.sef.json"),
    shouldDisplay
  );
}

function transformAndDisplay(
  sourceFileName,
  content,
  stylesheetFileName,
  shouldDisplay
) {
  return SaxonJS.transform(
    {
      stylesheetFileName,
      sourceText: content,
      destination: "serialized",
    },
    "async"
  )
    .then((output) => {
      let xrXML = output.principalResult;

      return SaxonJS.transform(
        {
          stylesheetFileName: path.join(
            __dirname,
            "xslt",
            "xrechnung-html." + currentLanguage + ".sef.json"
          ),
          sourceText: xrXML,
          destination: "serialized",
        },
        "async"
      )
      .then((response) => {
        let HTML = response.principalResult;
        // const htmlStr = `data:text/html;base64,${Buffer.from(HTML).toString(
        //   "base64"
        // )}`;
        //const htmlStr = `${Buffer.from(HTML).toString("base64")}`;
        //if (shouldDisplay) {
          //mainWindow.webContents.send("xml-open", [sourceFileName, htmlStr]); // send to be displayed
        //}
        //return htmlStr;
        const fileName = sourceFileName.replace(/^.*[\\\/]/, "");
        const tempPath = path.join(app.getPath("temp"), app.getName());
        const filePath = path.join(
          tempPath,
          `${path.parse(fileName).name}.html`
        );
        console.log("temp", filePath);
        try {
          if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath);
          }
          fs.writeFileSync(filePath, HTML, { flag: "w+" });
          if (shouldDisplay) {
            mainWindow.webContents.send("xml-open", [
              sourceFileName,
              filePath,
            ]);
          }
          return filePath;
        } catch (err) {
          console.log(err);
        }
      })
      .catch((error) => {
        displayError("Exception", error);
      });
  })
  .catch((output) => {
    displayError("Exception", output);
  });
}
function displayError(message, detail) {
  console.error(message, detail);
  const options = {
    type: "error",
    buttons: ["OK"],
    defaultId: 1,
    title: "Error",
    message,
    detail,
  };
  dialog.showMessageBox(null, options, (response, checkboxChecked) => {});
}
ipcMain.on("open-link", (event) => {
  let exWin = new BrowserWindow({
    width: 800,
    height: 600,
    icon: process.platform === "win32" ? "../assets/img/favicon.ico" : "../assets/img/logoonly.svg",
  });
  exWin.setMenu(null);
  exWin.loadURL("https://quba-viewer.org/beispiele/?pk_campaign=examples&pk_source=application");
});

ipcMain.on("open-dragged-file", (event, filePath) => {
  if (filePath.toLowerCase().includes(".pdf")) {
    mainWindow.webContents.send("pdf-open", [filePath, null]);
  } else if (filePath.toLowerCase().includes(".xml")) {
    loadAndDisplayXML(filePath);
    console.log("this is xml file and the path is ", filePath);
  }
});
ipcMain.on("open-menu", (event, arg) => {
  openFile();
});

ipcMain.on("open-validation", (event, arg) => {
  Validation();
});
