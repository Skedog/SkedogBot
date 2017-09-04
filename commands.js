const database = require('./database.js');
const constants = require('./constants.js');
const permissions = require('./permissions.js');
const functions = require('./functions.js');
const socket = require('./socket.js');

class Commands {

	async call(props) {
		switch (props.messageParams[1]) {
			case 'add':
				return this.add(props);
			case 'addalias':
				return this.addAlias(props);
			case 'edit':
				return this.edit(props);
			case 'delete':
			case 'remove':
				return this.delete(props);
			case 'permissions':
			case 'permission':
			case 'perms':
				return this.permission(props);
			default:
				return this.buildCommandLink(props);
		}
	}

	buildCommandLink(props) {
		const msgStr = 'The commands for this channel are available here: ';
		let msgURL;
		if (constants.testMode) {
			msgURL = constants.testPostURL + '/commands/' + props.channel.slice(1);
		} else {
			msgURL = constants.postURL + '/commands/' + props.channel.slice(1);
		}
		return functions.buildUserString(props) + msgStr + msgURL;
	}

	async add(props) {
		props.ignoreMessageParamsForUserString = true;
		const commandExistence = await this.doesUserAddedCommandExist(props);
		if (!commandExistence) {
			const dataToUse = {};
			dataToUse.trigger = props.messageParams[2].toLowerCase();
			dataToUse.chatmessage = props.messageParams.slice(3, props.messageParams.length).join(' ').replace('\'', '&apos;');
			dataToUse.commandcounter = 0;
			dataToUse.channel = props.channel;
			dataToUse.permissionsLevel = 0;
			dataToUse.isAlias = false;
			dataToUse.aliasFor = '';
			dataToUse.listArray = [];
			dataToUse.globalDelay = 0;
			dataToUse.userDelay = 0;
			if (dataToUse.trigger.charAt(0) === '!' && dataToUse.chatmessage !== '') {
				const propsForAdd = {
					table: 'commands',
					dataToUse
				};
				await database.add(propsForAdd);
				socket.io.in(functions.stripHash(props.channel)).emit('commands', ['added']);
				return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' has been added!';
			}
			return functions.buildUserString(props) + 'The syntax to add a command is !commands add !commandtoadd text';
		}
		return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' already exists!';
	}

	async addAlias(props) {
		props.ignoreMessageParamsForUserString = true;
		const commandExistence = await this.doesUserAddedCommandExist(props);
		if (!commandExistence) {
			if (props.messageParams[3]) {
				if (props.messageParams[2].charAt(0) === '!' && props.messageParams[3].charAt(0) === '!') {
					const dataToUse = {};
					dataToUse.trigger = props.messageParams[2].toLowerCase();
					dataToUse.chatmessage = 'Alias for ' + props.messageParams[3];
					dataToUse.commandcounter = 0;
					dataToUse.channel = props.channel;
					dataToUse.permissionsLevel = 0;
					dataToUse.isAlias = true;
					dataToUse.aliasFor = props.messageParams[3];
					dataToUse.listArray = [];
					dataToUse.globalDelay = 0;
					dataToUse.userDelay = 0;
					const propsForAdd = {
						table: 'commands',
						dataToUse
					};
					await database.add(propsForAdd);
					socket.io.in(functions.stripHash(props.channel)).emit('commands', ['added']);
					return functions.buildUserString(props) + 'The alias command ' + props.messageParams[2] + ' has been added!';
				}
			}
			return functions.buildUserString(props) + 'The syntax to add an alias is !commands addalias !newcommandname !commandtoalias';
		}
		return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' already exists!';
	}

	async edit(props) {
		props.ignoreMessageParamsForUserString = true;
		const commandExistence = await this.doesUserAddedCommandExist(props);
		if (commandExistence) {
			const tempLength = props.messageParams.length;
			const messageToAdd = props.messageParams.slice(3, tempLength).join(' ').replace('\'', '&apos;');
			const dataToUse = {};
			dataToUse.chatmessage = messageToAdd;
			const propsForUpdate = {
				table: 'commands',
				query: {channel: props.channel, trigger: props.messageParams[2]},
				dataToUse
			};
			await database.update(propsForUpdate);
			socket.io.in(functions.stripHash(props.channel)).emit('commands', ['updated']);
			return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' has been updated!';
		}
		return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' doesn\'t exist!';
	}

	async delete(props) {
		props.ignoreMessageParamsForUserString = true;
		const commandExistence = await this.doesUserAddedCommandExist(props);
		if (commandExistence) {
			const propsForDelete = {
				table: 'commands',
				query: {channel: props.channel, trigger: props.messageParams[2]}
			};
			await database.delete(propsForDelete);
			socket.io.in(functions.stripHash(props.channel)).emit('commands', ['deleted']);
			return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' has been deleted!';
		}
		return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' doesn\'t exist!';
	}

	async permission(props) {
		props.ignoreMessageParamsForUserString = true;
		let propsForSelect = {
			table: 'commands',
			query: {channel: props.channel, trigger: props.messageParams[2]}
		};
		let results = await database.select(propsForSelect);
		if (results) {
			const permissionLevelToSet = props.messageParams[3];
			const commandPermissionlevelNeeded = results[0].permissionsLevel;
			const userPermissionLevel = await permissions.getUserPermissionLevel(props);
			if (permissionLevelToSet <= userPermissionLevel && userPermissionLevel >= commandPermissionlevelNeeded) {
				if (functions.isNumber(permissionLevelToSet)) {
					const dataToUse = {};
					dataToUse.permissionsLevel = permissionLevelToSet;
					const propsForUpdate = {
						table: 'commands',
						query: {channel: props.channel, trigger: props.messageParams[2]},
						dataToUse
					};
					await database.update(propsForUpdate);
					socket.io.in(functions.stripHash(props.channel)).emit('commands', ['updated']);
					return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' permissions have been updated!';
				}
			}
		} else {
			// Select from default commands
			propsForSelect = {
				table: 'defaultCommands',
				query: {trigger: props.messageParams[2]}
			};
			results = await database.select(propsForSelect);
			if (results) {
				const aliasResults = await this.getAliasedDefaultCommand(props, results);
				const permissionLevelToSet = props.messageParams[3];
				const arrayOfPermissions = aliasResults[0].permissionsPerChannel;
				const userPermissionLevel = await permissions.getUserPermissionLevel(props);
				let commandPermissionlevelNeeded;
				for (let x = 0; x < arrayOfPermissions.length; x++) {
					if (aliasResults[0].permissionsPerChannel[x].channel === props.channel) {
						commandPermissionlevelNeeded = arrayOfPermissions[x].permissionLevel;
						break;
					}
				}
				if (permissionLevelToSet <= userPermissionLevel && userPermissionLevel >= commandPermissionlevelNeeded) {
					const propsForUpdate = {
						table: 'defaultCommands',
						query: {trigger: aliasResults[0].trigger, permissionsPerChannel: {$elemMatch: {channel: props.channel}}},
						dataToUse: {'permissionsPerChannel.$.permissionLevel': permissionLevelToSet}
					};
					results = await database.update(propsForUpdate);
					return functions.buildUserString(props) + 'The command ' + props.messageParams[2] + ' permissions have been updated!';
				}
			}
		}
		return functions.buildUserString(props) + 'Error setting permissions for ' + props.messageParams[2] + '!';
	}

	async getAliasedDefaultCommand(props, results) {
		if (results[0].isAlias) {
			const propsForSelect = {
				table: 'defaultCommands',
				query: {trigger: results[0].aliasFor}
			};
			const newResults = await database.select(propsForSelect);
			return this.getAliasedDefaultCommand(props, newResults);
		}
		return results;
	}

	async doesUserAddedCommandExist(props) {
		const propsForSelect = {
			table: 'commands',
			query: {channel: props.channel, trigger: props.messageParams[2]}
		};
		const res = await database.select(propsForSelect);
		if (res) {
			return true;
		}
		return false;
	}
}

module.exports = new Commands();
