/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'my-indicator-extension';

const { GObject, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const _ = ExtensionUtils.gettext;

const Gio = imports.gi.Gio;

const GLib = imports.gi.GLib;


async function hasHeadphoneActive() {
    try {

        const [ok, out] = await execCommand(['amixer', '-c0', 'get', 'Headphone'])
        // let [ok, out, err, exit] = GLib.spawn_command_line_sync(
        //     'amixer -c0 get Headphone'
        // );
        if (ok && out.length > 0) {
            return out[0].includes('[on]')
        }

        throw Error('Unexpected error');

    } catch (e) {
        logError(e, 'Fail to execute amixer');
        return false;
    }
}

async function execCommand(argv) {
    let cancelId = 0;

    const cancellable = new Gio.Cancellable();

    if (cancellable instanceof Gio.Cancellable)
        cancelId = cancellable.connect(() => proc.force_exit());

    try {
        const proc = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(cancellable);

        const [success, response] =
            await new Promise((resolve, reject) => {
                proc.communicate_utf8_async(null, cancellable, (proc, res) => {
                    try {
                        if (!proc.get_if_exited())
                            throw new Error("Subprocess failed to exit in time!");

                        resolve([proc.get_if_exited(), proc.communicate_utf8_finish(res).slice(1)])

                    } catch (e) {
                        reject(e);
                    }
                });
            });

        if (!success) {
            const status = proc.get_exit_status();

            throw new Gio.IOErrorEnum({
                code: Gio.IOErrorEnum.FAILED,
                message: `Command '${argv}' failed with exit code ${status}`,
            });
        }
        return [success, response]
    } finally {
        if (cancelId > 0)
            cancellable.disconnect(cancelId);
    }
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, _('Headphone Switch Indicator'));

            const internalIcon = new St.Icon({
                icon_name: 'audio-speakers-symbolic',
                style_class: 'system-status-icon',
            });

            const headphoneIcon = new St.Icon({
                icon_name: 'audio-headphones-symbolic',
                style_class: 'system-status-icon',
            });

            let internal = new PopupMenu.PopupMenuItem(_('Internal Speakers'));
            let headphone = new PopupMenu.PopupMenuItem(_('Headphone'));


            async function setInitialState(that) {
                try {

                    const [ok, out] = await execCommand(['amixer', '-c0', 'get', 'Speaker'])
                    //if has phone and the scpeaker was active
                    let speakerActive = false;
                    if (ok && out.length > 0) {
                        speakerActive = out[0].includes('[on]')
                    }
                    if (speakerActive && await hasHeadphoneActive()) {
                        internal.setSensitive(false);
                        internal.setOrnament(PopupMenu.Ornament.CHECK);
                        headphone.setSensitive(true);
                        headphone.setOrnament(PopupMenu.Ornament.NONE);
                        that.add_child(internalIcon);
                    } else {
                        internal.setSensitive(true);
                        internal.setOrnament(PopupMenu.Ornament.NONE);
                        headphone.setSensitive(false);
                        headphone.setOrnament(PopupMenu.Ornament.CHECK);
                        that.add_child(headphoneIcon);
                    }
                } catch (error) {
                    logError(error, 'Fail to set initial state');
                }
            }

            setInitialState(this);



            internal.connect('activate', async () => {
                try {
                    const [success] = await execCommand(['amixer', '-c', '0', 'set', 'Speaker', 'on', '100']);
                    if (success) {
                        internal.setSensitive(false);
                        internal.setOrnament(PopupMenu.Ornament.CHECK);
                        headphone.setSensitive(true);
                        headphone.setOrnament(PopupMenu.Ornament.NONE);
                        this.remove_child(headphoneIcon);
                        this.add_child(internalIcon);
                    } else {
                        throw Error('Fail on active internal')
                    }
                } catch (error) {
                    logError(error, "Fail on execute amixer activating speakers")
                    Main.notify(_('Error activating internal speakers'));
                }
            });

            headphone.connect('activate', async () => {
                try {
                    const [success] = await execCommand(['amixer', '-c', '0', 'set', 'Speaker', 'off', '0']);
                    if (success) {
                        headphone.setSensitive(false);
                        headphone.setOrnament(PopupMenu.Ornament.CHECK);
                        internal.setSensitive(true);
                        internal.setOrnament(PopupMenu.Ornament.NONE);
                        this.remove_child(internalIcon);
                        this.add_child(headphoneIcon);
                    } else {
                        throw Error('Fail on active headphone')
                    }
                } catch (error) {
                    logError(error, "Fail on execute amixer activating headphone")
                    Main.notify(_('Error activating headphone'));
                }
            });

            this.menu.addMenuItem(internal);
            this.menu.addMenuItem(headphone);
        }
    });

class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        let lastStatus = null;
        this._indicator = null;

        this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, async () => {
            try {

                const currentStatus = await hasHeadphoneActive();

                if (currentStatus != lastStatus) {
                    lastStatus = currentStatus;
                    if (currentStatus) {
                        if (this._indicator == null) {
                            this._indicator = new Indicator();
                            Main.panel.addToStatusArea(this._uuid, this._indicator);
                        }
                    } else {
                        if (this._indicator != null) {
                            this._indicator.destroy();
                            this._indicator = null;
                        }
                    }
                }

            } catch (error) {
                logError(error, "Fail to check headphone status")
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    async disable() {
        try {
            if (await hasHeadphoneActive())
                await execCommand(['amixer', '-c', '0', 'set', 'Speaker', 'off', '0']);
        } catch (error) {
            logError(error, "Fail on restore amixer:")
        }
        if (this._sourceId) {
            GLib.Source.remove(this._sourceId);
            this._sourceId = null;
        }
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}
