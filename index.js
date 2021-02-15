const fs = require('fs');
const yaml = require('js-yaml');
const { isDeepStrictEqual } = require('util');
const { isObject } = require('lodash');

const entity = 'ServerlessSecrets'
const DEBUG = process.env.SLS_DEBUG === '*'

class ServerlessSecretsPlugin {
    constructor(serverless, cliOptions) {

        this.error = serverless.classes.Error;
        this.serverless = serverless;
        this.options = serverless.service.custom.secrets;
        this.cliOptions = cliOptions || {};
        this.aws = this.serverless.getProvider('aws');

        this.hooks = {
            //'aws:info:displayStackOutputs': this.printSummary(),
            'secrets:secrets': () => this.serverless.cli.log(this.commands.secrets.usage),
            'secrets:deploy:deploy': this.deploySecrets.bind(this),
            'secrets:remove:remove': this.removeDeployedSecrets.bind(this),
            'after:aws:deploy:deploy:updateStack': () => this.serverless.pluginManager.run(['secrets', 'deploy']),
            'before:remove:remove': () => this.serverless.pluginManager.run(['secrets', 'remove']),
        };

        this.commands = {
            secrets: {
                usage: 'Upload secrets to SSM Parameter Store',
                lifecycleEvents: ['secrets'],
                commands: {
                    deploy: {
                        usage: 'Upload secrets',
                        lifecycleEvents: ['deploy']
                    },
                    remove: {
                        usage: 'Remove secrets',
                        lifecycleEvents: ['remove']
                    }
                }
            }
        };
    }

    async deploySecrets() {
        const ssmPath = this.options?.ssmPath || `/${this.serverless.service.service}-${this.serverless.service.provider.stage}/secrets/`

        const secrets = this.parseSecretsFile();

        await Promise.all(Object.entries(secrets).map(async ([name, secret]) => {
            if (await this.secretChanged(`${ssmPath}/${name}`, secret)) {
                this.serverless.cli.log(`- ${name} secret changed`, entity);
                await this.pushSecret(ssmPath + name, secret);
                this.serverless.cli.log(`  ${name} secret successfully upated`, entity);
            } else {
                this.serverless.cli.log(`- ${name} secret unchanged`, entity);
            }
        }));
    }

    parseSecretsFile() {
        const filePath = this.options.file

        if (!filePath) throw 'Please specify a secrets file'
        if (!fs.existsSync(filePath)) {
            this.serverless.cli.log('Secrets file not found, skipping...', entity)
            return {}
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const secrets = yaml.load(content);

        if (isObject(secrets)) return secrets
        else throw 'Secrets file must be valid yaml or json containing key-value pairs.'
    }

    async pushSecret(name, secret) {
        const putParameterRequest = {
            Name: name,
            Value: isObject(secret) ? JSON.stringify(secret) : secret,
            Type: 'SecureString',
            KeyId: 'alias/aws/ssm',
            Overwrite: true
        }

        const putParameterResponse = await this.aws.request('SSM', 'putParameter', putParameterRequest);
        if (DEBUG) this.serverless.cli.log(`SSM PutParameter response: ${JSON.stringify(putParameterResponse)}`, entity);
    }

    async secretChanged(name, newSecret) {
        try {
            const getParameterRequest = {
                Name: name,
                WithDecryption: true
            }
            const getParameterResponse = await this.aws.request('SSM', 'getParameter', getParameterRequest);
            if (DEBUG) this.serverless.cli.log(`SSM GetParameter response: ${JSON.stringify(getParameterResponse)}`, entity);
            const currentSecret = yaml.load(getParameterResponse.Parameter.Value);
            return !isDeepStrictEqual(newSecret, currentSecret)
        } catch (e) {
            return true;
        }
    }

    removeDeployedSecrets() {
        //TODO
    }
}

module.exports = ServerlessSecretsPlugin;