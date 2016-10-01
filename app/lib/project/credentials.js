var Promise           = require('bluebird');
var fs                = require('fs-extra-promise');
var path              = require('path');
var keychain          = require('../services/keychain');
var config            = require('../../config');
var util              = require('../util');
var logger            = require('winston');

var Credentials = function(project) {
  this._project = project;
  this._credsJsonPath = path.join(project.path, '.mavensmate', 'credentials.json');
  this._observeCredentialsUpdates(project.sfdcClient);
};

/**
 * Whether the user is storing credentials in credentials.json (unadvised)
 * @return {Boolean}
 */
Credentials.prototype.hasCredentialsJson = function() {
  return fs.existsSync(this._credsJsonPath);
};

/**
 * Observe for token refreshes and update accordingly
 * @return {Nothing}
 */
Credentials.prototype._observeCredentialsUpdates = function(sfdcClient) {
  var self = this;
  sfdcClient.on('token-refresh', function() {
    logger.debug('project.sfdcClient emitted token-refresh, updating local credential store');
    try {
      self.update({
        instanceUrl: sfdcClient.getInstanceUrl(),
        accessToken: sfdcClient.accessToken,
        refreshToken: sfdcClient.refreshToken
      });
    } catch(err) {
      logger.error('Could not update credentials', err);
      throw err;
    }
  });
}

/**
 * Updates credentials on local file system
 * 1. If keychain is enabled && user wants to use it, and they don't have a credentials.json file in their project/.mavensmate directory, store in keychain
 * 2. Otherwise, written to project config
 * @return {Nothing}
 */
Credentials.prototype.update = function(creds) {
  var self = this;
  return new Promise(function(resolve, reject) {
    try {
      logger.debug('updating credentials', creds);
      if (creds.instanceUrl) {
        self._project.projectJson.set('instanceUrl', creds.instanceUrl);
      }
      if (keychain.isAvailable() && config.get('mm_use_keyring') && !self.hasCredentialsJson()) {
        if (creds.password) {
          keychain.replacePassword(self._project.id, creds.password, 'password');
        } else {
          keychain.replacePassword(self._project.id, creds.accessToken, 'accessToken');
          keychain.replacePassword(self._project.id, creds.refreshToken, 'refreshToken');
        }
      } else {
        var credsBody;
        if (creds.password) {
          credsBody = {
            password: creds.password
          };
        } else {
          credsBody = {
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken
          };
        }
        fs.outputFileSync(_credsJsonPath, JSON.stringify(credsBody, null, 4));
      }
      resolve();
    } catch(e) {
      logger.error('Could not update local creds', e);
      reject(e);
    }
  });
};

/**
 * Retrieves credentials from storage
 * 1. If keychain is enabled && user wants to use it, and they don't have a credentials.json file in their project/.mavensmate directory, retrieve from keychain
 * 2. Otherwise, retrieve from project config
 * @return {[type]} [description]
 */
Credentials.prototype.get = function() {
  if (keychain.isAvailable() && config.get('mm_use_keyring') && !this.hasCredentialsJson()) {
    var creds = {};
    if (sfdcClient.password) {
      creds.password = keychain.getPassword(this._project.id, 'password');
    } else {
      creds.accessToken = keychain.getPassword(this._project.id, 'accessToken');
      creds.refreshToken = keychain.getPassword(this._project.id, 'refreshToken');
    }
    return creds;
  } else {
    return util.getFileBodySync(this._credsJsonPath, true);
  }
};

/**
 * Convenience function to get creds on project intialization
 * @param  {Project} project
 * @return {Object}  credentials
 */
Credentials.getForProject = function(project) {
  var credsPath = path.join(project.path, '.mavensmate', 'credentials.json');
  if (keychain.isAvailable() && config.get('mm_use_keyring') && !fs.existsSync(credsPath)) {
    return {
      password: keychain.getPassword(project.id, 'password', true),
      accessToken: keychain.getPassword(project.id, 'accessToken', true),
      refreshToken: keychain.getPassword(project.id, 'refreshToken', true),
    }
  } else {
    return util.getFileBodySync(credsPath, true);
  }
};

/**
 * Stores credentials on the disk, either in a credentials.json file or in secure keychain storage
 * @param  {String} projectPath - project path
 * @param  {String} projectId   - id of the project
 * @param  {SalesforceClient} sfdcClient
 * @return {Nothing}
 */
Credentials.create = function(projectPath, projectId, sfdcClient) {
  if (keychain.isAvailable() && config.get('mm_use_keyring')) {
    if (sfdcClient.password) {
      keychain.storePassword(projectId, sfdcClient.password, 'password');
    } else {
      keychain.storePassword(projectId, sfdcClient.accessToken, 'accessToken');
      keychain.storePassword(projectId, sfdcClient.refreshToken, 'refreshToken');
    }
  } else {
    var projectCredsPath = path.join(projectPath, '.mavensmate', 'credentials.json');
    var credsBody;
    if (sfdcClient.password) {
      credsBody = {
        password: sfdcClient.password
      };
    } else {
      credsBody = {
        accessToken: sfdcClient.accessToken,
        refreshToken: sfdcClient.refreshToken
      };
    }
    fs.outputFileSync(projectCredsPath, JSON.stringify(credsBody, null, 4));
  }
};

module.exports = Credentials;