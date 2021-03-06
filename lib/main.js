'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var fs = require('fs-extra');
var fsu = require('fsu');
var path = require('path');
var React = require('react');
var opener = require('opener');
var dateFormat = require('dateformat');
var render = require('react-dom/server').renderToStaticMarkup;
var MainHTML = require('./main-html');
var pkg = require('../package.json');

var _require = require('./options'),
    getMergedOptions = _require.getMergedOptions;

var distDir = path.join(__dirname, '..', 'dist');
var fileExtRegex = /\.[^.]*?$/;

/**
 * Saves a file
 *
 * @param {string} filename Name of file to save
 * @param {string} data Data to be saved
 * @param {boolean} overwrite Overwrite existing files (default: true)
 *
 * @return {Promise} Resolves with filename if successfully saved
 */
function saveFile(filename, data, overwrite) {
  if (overwrite) {
    return fs.outputFile(filename, data).then(function () {
      return filename;
    });
  } else {
    return new Promise(function (resolve, reject) {
      fsu.writeFileUnique(filename.replace(fileExtRegex, '{_###}$&'), data, { force: true }, function (err, savedFile) {
        return err === null ? resolve(savedFile) : reject(err);
      });
    });
  }
}

/**
 * Opens a file
 *
 * @param {string} filename Name of file to open
 *
 * @return {Promise} Resolves with filename if successfully opened
 */
function openFile(filename) {
  return new Promise(function (resolve, reject) {
    opener(filename, null, function (err) {
      return err === null ? resolve(filename) : reject(err);
    });
  });
}

/**
 * Synchronously loads a file with utf8 encoding
 *
 * @param {string} filename Name of file to load
 *
 * @return {string} File data as string
 */
function loadFile(filename) {
  return fs.readFileSync(filename, 'utf8');
}

/**
 * Get the dateformat format string based on the timestamp option
 *
 * @param {string|boolean} timestamp Timestamp option value
 *
 * @return {string} Valid dateformat format string
 */
function getTimestampFormat(timestamp) {
  switch (timestamp) {
    case '':
    case 'true':
    case true:
      return 'isoDateTime';
    default:
      return timestamp;
  }
}

/**
 * Construct the path/name of the HTML/JSON file to be saved
 *
 * @param {Object} reportOptions Options object
 * @param {string} reportOptions.reportDir Directory to save report to
 * @param {string} reportOptions.reportFilename Filename to save report to
 * @param {string} reportOptions.timestamp Timestamp format to be appended to the filename
 *
 * @return {string} Fully resolved path without extension
 */
function getFilename(_ref) {
  var reportDir = _ref.reportDir,
      _ref$reportFilename = _ref.reportFilename,
      reportFilename = _ref$reportFilename === undefined ? 'mochawesome' : _ref$reportFilename,
      timestamp = _ref.timestamp;

  var ts = '';
  if (timestamp !== false && timestamp !== 'false') {
    var format = getTimestampFormat(timestamp);
    ts = ('_' + dateFormat(new Date(), format)
    // replace commas, spaces or comma-space combinations with underscores
    ).replace(/(,\s*)|,|\s+/g, '_')
    // replace forward and back slashes with hyphens
    .replace(/\\|\//g, '-')
    // remove colons
    .replace(/:/g, '');
  }
  var filename = '' + reportFilename.replace(fileExtRegex, '') + ts;
  return path.resolve(process.cwd(), reportDir, filename);
}

/**
 * Get report options by extending base options
 * with user provided options
 *
 * @param {Object} opts Report options
 *
 * @return {Object} User options merged with default options
 */
function getOptions(opts) {
  var mergedOptions = getMergedOptions(opts || {});

  // For saving JSON from mochawesome reporter
  if (mergedOptions.saveJson) {
    mergedOptions.jsonFile = getFilename(mergedOptions) + '.json';
  }

  mergedOptions.htmlFile = getFilename(mergedOptions) + '.html';
  return mergedOptions;
}

/**
 * Determine if assets should be copied following below logic:
 * - Assets folder does not exist -> copy assets
 * - Assets folder exists -> load the css asset to inspect the banner
 * - Error loading css file -> copy assets
 * - Read the package version from the css asset
 * - Asset version is not found -> copy assets
 * - Asset version differs from current version -> copy assets
 *
 * @param {string} assetsDir Directory where assets should be saved
 *
 * @return {boolean} Should assets be copied
 */
function _shouldCopyAssets(assetsDir) {
  if (!fs.existsSync(assetsDir)) {
    return true;
  }

  try {
    var appCss = loadFile(path.join(assetsDir, 'app.css'));
    var appCssVersion = /\d+\.\d+\.\d+/.exec(appCss);
    if (!appCssVersion || appCssVersion[0] !== pkg.version) {
      return true;
    }
  } catch (e) {
    return true;
  }

  return false;
}

/**
 * Copy the report assets to the report dir, ignoring inline assets
 *
 * @param {Object} opts Report options
 */
function copyAssets(_ref2) {
  var assetsDir = _ref2.assetsDir;

  if (_shouldCopyAssets(assetsDir)) {
    fs.copySync(distDir, assetsDir, {
      filter: function filter(src) {
        return !/inline/.test(src);
      }
    });
  }
}

/**
 * Get the report assets object
 *
 * @param {Object} reportOptions Options
 * @return {Object} Object with assets props
 */
function getAssets(reportOptions) {
  var assetsDir = reportOptions.assetsDir,
      cdn = reportOptions.cdn,
      dev = reportOptions.dev,
      inlineAssets = reportOptions.inlineAssets,
      reportDir = reportOptions.reportDir;

  var relativeAssetsDir = path.relative(reportDir, assetsDir);

  // Default URLs to assets path
  var assets = {
    inlineScripts: null,
    inlineStyles: null,
    scriptsUrl: path.join(relativeAssetsDir, 'app.js'),
    stylesUrl: path.join(relativeAssetsDir, 'app.css')
  };

  // If using inline assets, load files and strings
  if (inlineAssets) {
    assets.inlineScripts = loadFile(path.join(distDir, 'app.js'));
    assets.inlineStyles = loadFile(path.join(distDir, 'app.inline.css'));
  }

  // If using CDN, return remote urls
  if (cdn) {
    assets.scriptsUrl = 'https://unpkg.com/mochawesome-report-generator@' + pkg.version + '/dist/app.js';
    assets.stylesUrl = 'https://unpkg.com/mochawesome-report-generator@' + pkg.version + '/dist/app.css';
  }

  // In DEV mode, return local urls
  if (dev) {
    assets.scriptsUrl = 'http://localhost:8080/app.js';
    assets.stylesUrl = 'http://localhost:8080/app.css';
  }

  // Copy the assets if needed
  if (!dev && !cdn && !inlineAssets) {
    copyAssets(reportOptions);
  }

  return assets;
}

/**
 * Prepare options, assets, and html for saving
 *
 * @param {string} reportData JSON test data
 * @param {Object} opts Report options
 *
 * @return {Object} Prepared data for saving
 */
function prepare(reportData, opts) {
  // Stringify the data if needed
  var data = reportData;
  if ((typeof data === 'undefined' ? 'undefined' : _typeof(data)) === 'object') {
    data = JSON.stringify(reportData);
  }

  // Get the options
  var reportOptions = getOptions(opts);

  // Get the assets
  var assets = getAssets(reportOptions);

  // Render basic template to string
  // const { styles, scripts } = assets;

  var renderedHtml = render(React.createElement(MainHTML, _extends({
    data: data,
    options: reportOptions,
    title: reportOptions.reportPageTitle,
    useInlineAssets: reportOptions.inlineAssets && !reportOptions.cdn
  }, assets)));

  var html = '<!doctype html>\n' + renderedHtml;
  return { html: html, reportOptions: reportOptions };
}

/**
 * Create the report
 *
 * @param {string} data JSON test data
 * @param {Object} opts Report options
 *
 * @return {Promise} Resolves if report was created successfully
 */
function create(data, opts) {
  var _prepare = prepare(data, opts),
      html = _prepare.html,
      reportOptions = _prepare.reportOptions;

  var saveJson = reportOptions.saveJson,
      saveHtml = reportOptions.saveHtml,
      autoOpen = reportOptions.autoOpen,
      overwrite = reportOptions.overwrite,
      jsonFile = reportOptions.jsonFile,
      htmlFile = reportOptions.htmlFile;


  var savePromises = [];

  savePromises.push(saveHtml !== false ? saveFile(htmlFile, html, overwrite).then(function (savedHtml) {
    return autoOpen && openFile(savedHtml) || savedHtml;
  }) : null);

  savePromises.push(saveJson ? saveFile(jsonFile, JSON.stringify(data, null, 2), overwrite) : null);

  return Promise.all(savePromises);
}

/**
 * Create the report synchronously
 *
 * @param {string} data JSON test data
 * @param {Object} opts Report options
 *
 */
function createSync(data, opts) {
  var _prepare2 = prepare(data, opts),
      html = _prepare2.html,
      reportOptions = _prepare2.reportOptions;

  var autoOpen = reportOptions.autoOpen,
      htmlFile = reportOptions.htmlFile;

  fs.outputFileSync(htmlFile, html);
  if (autoOpen) opener(htmlFile);
}

/**
 * Expose functions
 *
 */
module.exports = { create: create, createSync: createSync, renderHtml: prepare };