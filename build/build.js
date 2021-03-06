const parameterize = require("json-parameterization");
const fs = require("fs");
const yaml = require("yaml");
const dotenv = require("dotenv");
const crypto = require("crypto");
const path = require("path");
const core = require("@actions/core");

module.exports = {
  deploymentByDirChanges: function() {
    try {
      const modFilesArr = JSON.parse(fs.readFileSync(`${process.env.HOME}/files_modified.json`));
      const addedFilesArr = JSON.parse(fs.readFileSync(`${process.env.HOME}/files_added.json`));

      const filesArr = [...modFilesArr, ...addedFilesArr];

      console.log("filesArr: ", filesArr);

      var directories = [];
      var K_DEPLOYMENT_STR = "";
      filesArr.forEach(filepath => {
        let dirsepArr = filepath.split(path.sep);
        if (dirsepArr[0] === "lambdas" && directories.indexOf(dirsepArr[1]) === -1) {
          directories.push(dirsepArr[1]);
          K_DEPLOYMENT_STR = `${K_DEPLOYMENT_STR} -f ./build/deployments/deployment_${dirsepArr[1]}.yaml`;
        }
      });

      console.log("Processing directories: ", directories);
      console.log("K_DEPLOYMENT_STR: ", K_DEPLOYMENT_STR);
      core.setOutput("K_DEPLOYMENT_STR", K_DEPLOYMENT_STR);

      directories.forEach(dir => {
        this.deploymentYaml(dir);
      });
    } catch (error) {
      console.log(error);
    }
  },

  deploymentYaml: function(directory) {
    const rootDir = process.env.FUNCTIONDIR || directory;

    console.log("creating deployment for: ", rootDir);

    if (rootDir === undefined) {
      return;
    }

    const functionDir = path.join("./lambdas", rootDir);

    var deploymentJSON = JSON.parse(fs.readFileSync("./build/templates/deployment-template.json"));

    const packageStr = fs.readFileSync(path.join(functionDir, "package.json")).toString();
    const packageJSON = JSON.parse(packageStr);
    const lamdbdCode = fs.readFileSync(path.join(functionDir, packageJSON.main)).toString();
    const envVarData = dotenv.parse(fs.readFileSync(path.join(functionDir, ".env")).toString());
    const envVars = Object.entries(envVarData);
    const sha256Str =
      "sha256:" +
      crypto
        .createHash("sha256")
        .update(lamdbdCode)
        .digest("hex");

    var envArr = [];

    for (const [name, value] of envVars) {
      let tempObj = {
        name: name,
        value: value
      };
      envArr.push(tempObj);
    }

    const params = {
      function_name: packageJSON.name,
      function_size: packageJSON.buildParameters.function_size,
      environment_variables: envArr,
      function_deps: packageStr,
      function_code: lamdbdCode,
      namespace: packageJSON.buildParameters.namespace,
      checksum: sha256Str
    };

    const horizontalPodAutoscalerJSON = JSON.parse(
      fs
        .readFileSync(
          "./build/templates/horizontalPodAutoscaler_" + packageJSON.buildParameters.function_size + ".json"
        )
        .toString()
    );

    params.horizontalPodAutoscaler = parameterize(horizontalPodAutoscalerJSON, params);

    const deploymentYAML = parameterize(deploymentJSON, params);

    var yamlStr = yaml.stringify(deploymentYAML);

    if (packageJSON.buildParameters.enable_api) {
      console.log("enabling api for function");
      const apiJSON = JSON.parse(fs.readFileSync("./build/templates/api-template.json").toString());
      const apiYAML = parameterize(apiJSON, params);
      yamlStr += "\n---\n" + yaml.stringify(apiYAML);
    }

    if (!fs.existsSync("./build/deployments")) {
      fs.mkdirSync("./build/deployments");
    }

    fs.writeFileSync(`./build/deployments/deployment_${rootDir}.yaml`, yamlStr);
  }
};
